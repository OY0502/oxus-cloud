import {
  defaultImportSettings,
  defaultSourcesEnabled,
  getGoogleOAuthBaseUrl,
  getServiceRoleSupabase,
  normalizeGoogleRedirectPath,
  resolveGoogleAppBaseUrl,
} from "../_shared/google-auth.ts";
import { encryptGoogleToken, hasGoogleTokenEncryptionKey } from "../_shared/googleTokenCrypto.ts";
import { assertInternalOxusUserId, InternalOxusAuthError } from "../_shared/internalOxusAuth.ts";
import { queueGoogleImport } from "../_shared/googleSyncWorker.ts";
import {
  acquireGoogleSyncRun,
  buildGoogleOperationIdentity,
  bumpConnectionGeneration,
  interruptActiveGoogleImportRuns,
} from "../_shared/googleImportLock.ts";

function buildAppUrl(path: string, request: Request): string {
  return `${resolveGoogleAppBaseUrl(request)}${path.startsWith("/") ? path : `/${path}`}`;
}

function redirectTo(path: string, request: Request): Response {
  return new Response(null, { status: 302, headers: { Location: buildAppUrl(path, request), "Cache-Control": "no-store" } });
}

function appendGoogleQuery(path: string, request: Request, status: "connected" | "error", message?: string): string {
  const url = new URL(normalizeGoogleRedirectPath(path, request), resolveGoogleAppBaseUrl(request));
  url.searchParams.set("google", status);
  if (status === "error" && message) url.searchParams.set("message", message.slice(0, 500));
  return `${url.pathname}${url.search}`;
}

function redirectError(request: Request, message: string, redirectAfter?: string | null): Response {
  return redirectTo(appendGoogleQuery(redirectAfter ?? "/settings/integrations", request, "error", message), request);
}

function redirectSuccess(request: Request, redirectAfter?: string | null): Response {
  return redirectTo(appendGoogleQuery(redirectAfter ?? "/settings/integrations", request, "connected"), request);
}

async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
}> {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")?.trim();
  const redirectUri = Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI")?.trim();
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google OAuth is not configured.");

  const resp = await fetch(`${getGoogleOAuthBaseUrl()}/o/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Google token exchange failed: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function fetchGoogleUserInfo(accessToken: string): Promise<{ sub: string; email: string }> {
  const resp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Google userinfo failed: ${text.slice(0, 400)}`);
  const data = JSON.parse(text) as { sub?: string; email?: string };
  if (!data.sub || !data.email) throw new Error("Google userinfo missing identity.");
  return { sub: data.sub, email: data.email };
}

type SyncModeDecision = {
  runType: "initial" | "incremental";
  syncMode: "initial_import" | "incremental_sync" | "checkpoint_recovery";
  sources: string[];
};

async function resolveReconnectSyncMode(
  admin: ReturnType<typeof getServiceRoleSupabase>,
  connectionId: string,
  sourcesEnabled: Record<string, boolean>,
  options: { sameAccount: boolean; gmailNewlyGranted: boolean; hadExistingConnection: boolean },
): Promise<SyncModeDecision> {
  const enabledSources = [
    ...(sourcesEnabled.contacts !== false ? ["contacts"] : []),
    ...(sourcesEnabled.calendar !== false ? ["calendar"] : []),
    ...(sourcesEnabled.gmail ? ["gmail"] : []),
  ];

  if (options.gmailNewlyGranted && options.hadExistingConnection) {
    return { runType: "incremental", syncMode: "incremental_sync", sources: ["gmail"] };
  }

  if (!options.hadExistingConnection || !options.sameAccount) {
    return {
      runType: "initial",
      syncMode: "initial_import",
      sources: enabledSources.length ? enabledSources : ["contacts", "calendar"],
    };
  }

  const { data: syncStates } = await admin
    .from("google_sync_states")
    .select("source, resource_key, initial_sync_completed, sync_token, history_id")
    .eq("connection_id", connectionId);

  const states = syncStates ?? [];
  const contactsOk = states.some((s) => s.source === "contacts" && s.initial_sync_completed);
  const calendarOk = states.some((s) => s.source === "calendar" && s.initial_sync_completed && s.sync_token);
  const gmailOk = !sourcesEnabled.gmail
    || states.some((s) => s.source === "gmail" && s.initial_sync_completed && s.history_id);

  if (contactsOk || calendarOk || gmailOk) {
    const recoverySources: string[] = [];
    if (sourcesEnabled.contacts !== false && !contactsOk) recoverySources.push("contacts");
    if (sourcesEnabled.calendar !== false && !calendarOk) recoverySources.push("calendar");
    if (sourcesEnabled.gmail && !gmailOk) recoverySources.push("gmail");

    if (recoverySources.length > 0 && recoverySources.length < enabledSources.length) {
      return {
        runType: "incremental",
        syncMode: "checkpoint_recovery",
        sources: enabledSources,
      };
    }

    return {
      runType: "incremental",
      syncMode: "incremental_sync",
      sources: enabledSources,
    };
  }

  return {
    runType: "initial",
    syncMode: "initial_import",
    sources: enabledSources.length ? enabledSources : ["contacts", "calendar"],
  };
}

Deno.serve(async (req) => {
  try {
    resolveGoogleAppBaseUrl(req);
    const url = new URL(req.url);
    const code = url.searchParams.get("code")?.trim();
    const state = url.searchParams.get("state")?.trim();
    if (!code || !state) return redirectError(req, "Missing OAuth code or state.");
    if (!hasGoogleTokenEncryptionKey()) return redirectError(req, "Google token encryption is not configured.");

    const admin = getServiceRoleSupabase();
    const { data: oauthState } = await admin.from("google_oauth_states").select("*").eq("state", state).maybeSingle();
    if (!oauthState || oauthState.status !== "pending") return redirectError(req, "Invalid OAuth state.");
    if (new Date(oauthState.expires_at).getTime() < Date.now()) {
      await admin.from("google_oauth_states").update({ status: "expired" }).eq("id", oauthState.id);
      return redirectError(req, "OAuth session expired.", oauthState.redirect_after as string | null);
    }

    try {
      await assertInternalOxusUserId(oauthState.user_id, admin);
    } catch (e) {
      const message = e instanceof InternalOxusAuthError ? e.message : "Authentication required.";
      return redirectError(req, message, oauthState.redirect_after as string | null);
    }

    // One-time use: claim state before token exchange side effects complete.
    const { data: claimed } = await admin
      .from("google_oauth_states")
      .update({ status: "used", used_at: new Date().toISOString() })
      .eq("id", oauthState.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) {
      return redirectError(req, "OAuth state already used.", oauthState.redirect_after as string | null);
    }

    let tokens;
    try {
      tokens = await exchangeCodeForTokens(code);
    } catch (e) {
      await admin.from("google_oauth_states").update({ status: "failed" }).eq("id", oauthState.id);
      return redirectError(req, (e as Error).message, oauthState.redirect_after as string | null);
    }

    const userInfo = await fetchGoogleUserInfo(tokens.access_token);
    const encryptedAccess = await encryptGoogleToken(tokens.access_token);
    const encryptedRefresh = tokens.refresh_token ? await encryptGoogleToken(tokens.refresh_token) : null;

    const { data: existingConn } = await admin
      .from("user_google_connections")
      .select("id, refresh_token_encrypted, sources_enabled, import_settings, granted_scopes, google_account_id, status, connection_generation")
      .eq("user_id", oauthState.user_id)
      .maybeSingle();

    const refreshToStore = encryptedRefresh ?? existingConn?.refresh_token_encrypted ?? null;
    const newScopes = tokens.scope?.split(" ").filter(Boolean) ?? (oauthState.requested_scopes as string[]) ?? [];
    const hadGmailBefore = (existingConn?.granted_scopes as string[] | undefined)?.includes(
      "https://www.googleapis.com/auth/gmail.readonly",
    ) ?? false;
    const mergedScopes = [...new Set([...(existingConn?.granted_scopes as string[] ?? []), ...newScopes])];
    const hasGmailAfter = mergedScopes.includes("https://www.googleapis.com/auth/gmail.readonly");
    const sourcesEnabled = {
      ...(existingConn?.sources_enabled as Record<string, boolean> ?? defaultSourcesEnabled()),
      contacts: true,
      calendar: true,
      gmail: hasGmailAfter || (existingConn?.sources_enabled as Record<string, boolean>)?.gmail === true,
    };
    const importSettings = {
      ...(existingConn?.import_settings as Record<string, unknown> ?? defaultImportSettings()),
      import_gmail: sourcesEnabled.gmail,
    };
    const now = new Date().toISOString();
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const sameAccount = !!existingConn?.google_account_id
      && existingConn.google_account_id === userInfo.sub;
    const wasDisconnected = existingConn?.status === "revoked" || existingConn?.status === "error";
    const isReconnect = !!existingConn && (wasDisconnected || sameAccount);

    if (existingConn?.id) {
      await interruptActiveGoogleImportRuns(admin, existingConn.id, {
        reasonCode: "GOOGLE_SYNC_INTERRUPTED_BY_RECONNECT",
        reasonMessage: "Previous Google sync was interrupted by a reconnect.",
      });
    }

    let connectionGeneration = Number(existingConn?.connection_generation ?? 1);
    if (isReconnect && existingConn?.id) {
      connectionGeneration = await bumpConnectionGeneration(admin, existingConn.id);
    }

    const { data: connection, error: upsertErr } = await admin.from("user_google_connections").upsert(
      {
        user_id: oauthState.user_id,
        google_account_id: userInfo.sub,
        google_email: userInfo.email,
        access_token_encrypted: encryptedAccess,
        refresh_token_encrypted: refreshToStore,
        granted_scopes: mergedScopes,
        token_expires_at: tokenExpiresAt,
        status: "active",
        sources_enabled: sourcesEnabled,
        import_settings: importSettings,
        connected_at: now,
        disconnected_at: null,
        last_sync_error: null,
        connection_generation: connectionGeneration,
        updated_at: now,
      },
      { onConflict: "user_id" },
    ).select("id, connection_generation, google_account_id").single();

    if (upsertErr) {
      return redirectError(req, `Failed to save Google connection: ${upsertErr.message}`, oauthState.redirect_after as string | null);
    }

    const { data: fullConnection } = await admin.from("user_google_connections").select("*").eq("id", connection!.id).single();
    if (fullConnection) {
      const { ensureDefaultCalendarSelection } = await import("../_shared/googleCalendarHelpers.ts");
      await ensureDefaultCalendarSelection(admin, fullConnection as import("../_shared/google-auth.ts").GoogleConnectionRow);
    }

    const mode = await resolveReconnectSyncMode(admin, connection!.id, sourcesEnabled, {
      sameAccount: sameAccount || !existingConn,
      gmailNewlyGranted: hasGmailAfter && !hadGmailBefore,
      hadExistingConnection: !!existingConn,
    });

    const operationIdentity = buildGoogleOperationIdentity({
      connectionId: connection!.id,
      googleAccountId: userInfo.sub,
      connectionGeneration,
      syncMode: mode.runType,
    });

    const acquired = await acquireGoogleSyncRun(admin, {
      connection_id: connection!.id,
      owner_user_id: oauthState.user_id as string,
      run_type: mode.runType,
      sources: mode.sources,
      lookback_months: importSettings.lookback_months as number,
      settings: {
        ...importSettings,
        reconnect_sync_mode: mode.syncMode,
      },
      connection_generation: connectionGeneration,
      operation_identity: operationIdentity,
      sync_mode: mode.runType,
    });

    let triggerRunId: string | null = acquired.import_run.trigger_run_id;
    let dispatchOk = acquired.already_running && !!triggerRunId;

    if (!acquired.already_running) {
      try {
        const queued = await queueGoogleImport(
          admin,
          acquired.import_run.id,
          connection!.id,
          oauthState.user_id as string,
          {
            connectionGeneration,
            operationIdentity,
            syncMode: mode.runType,
          },
        );
        triggerRunId = queued.trigger_run_id;
        dispatchOk = true;
      } catch (dispatchError) {
        const message = (dispatchError as Error).message?.slice(0, 300) ?? "Failed to dispatch Google sync.";
        await admin.from("google_import_runs").update({
          status: "failed",
          progress_stage: "failed",
          error_code: "GOOGLE_SYNC_DISPATCH_FAILED",
          error: message,
          dispatch_status: "dispatch_failed",
          failed_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
        }).eq("id", acquired.import_run.id);

        console.error("[google-oauth-callback]", JSON.stringify({
          event: "google_oauth_dispatch_failed",
          connection_id: connection!.id,
          import_run_id: acquired.import_run.id,
          connection_generation: connectionGeneration,
          error_code: "GOOGLE_SYNC_DISPATCH_FAILED",
        }));

        return redirectError(
          req,
          "Google connected, but background sync could not be started. Open CRM and retry sync.",
          oauthState.redirect_after as string | null,
        );
      }
    }

    console.info("[google-oauth-callback]", JSON.stringify({
      event: "google_oauth_connected",
      user_id: oauthState.user_id,
      connection_id: connection!.id,
      google_account_id: userInfo.sub,
      connection_generation: connectionGeneration,
      sync_mode: mode.syncMode,
      run_type: mode.runType,
      import_run_id: acquired.import_run.id,
      already_running: acquired.already_running,
      trigger_run_id: triggerRunId,
      dispatch_ok: dispatchOk,
      sources: mode.sources,
      same_account: sameAccount,
      is_reconnect: isReconnect,
    }));

    return redirectSuccess(req, oauthState.redirect_after as string | null);
  } catch (e) {
    console.error("[google-oauth-callback]", (e as Error).message);
    return redirectError(req, (e as Error).message || "Unexpected OAuth error.");
  }
});
