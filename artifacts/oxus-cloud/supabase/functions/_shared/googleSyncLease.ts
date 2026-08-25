import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const CALENDAR_FRESHNESS_MS = 15 * 60 * 1000;
export const CALENDAR_MANUAL_COOLDOWN_MS = 2 * 60 * 1000;
export const DEFAULT_LEASE_TTL_MS = 10 * 60 * 1000;

export type GoogleSyncLeaseRow = {
  lease_key: string;
  connection_id: string;
  sync_type: string;
  run_id: string | null;
  owner: string | null;
  acquired_at: string;
  heartbeat_at: string;
  expires_at: string;
  status: string;
  sync_reason: string | null;
  counters: Record<string, unknown>;
  error: string | null;
};

export function calendarLeaseKey(connectionId: string): string {
  return `google-sync:${connectionId}:calendar`;
}

export function connectionLeaseKey(connectionId: string): string {
  return `google-sync:${connectionId}`;
}

export async function expireStaleLeases(admin: SupabaseClient): Promise<number> {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("google_sync_leases")
    .update({ status: "expired", updated_at: now })
    .eq("status", "active")
    .lt("expires_at", now)
    .select("lease_key");
  return data?.length ?? 0;
}

export async function getActiveLease(
  admin: SupabaseClient,
  leaseKey: string,
): Promise<GoogleSyncLeaseRow | null> {
  await expireStaleLeases(admin);
  const { data } = await admin
    .from("google_sync_leases")
    .select("*")
    .eq("lease_key", leaseKey)
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await admin.from("google_sync_leases").update({ status: "expired" }).eq("lease_key", leaseKey);
    return null;
  }
  return data as GoogleSyncLeaseRow;
}

export type AcquireLeaseResult =
  | { acquired: true; lease: GoogleSyncLeaseRow }
  | { acquired: false; reason: "already_active"; lease: GoogleSyncLeaseRow }
  | { acquired: false; reason: "fresh"; last_sync_at: string | null };

export async function acquireCalendarSyncLease(
  admin: SupabaseClient,
  input: {
    connection_id: string;
    sync_reason: string;
    owner?: string;
    run_id?: string;
    force?: boolean;
    freshness_ms?: number;
    ttl_ms?: number;
  },
): Promise<AcquireLeaseResult> {
  const freshnessMs = input.freshness_ms ?? CALENDAR_FRESHNESS_MS;
  const leaseKey = calendarLeaseKey(input.connection_id);

  const { data: connection } = await admin
    .from("user_google_connections")
    .select("calendar_last_synced_at, last_successful_sync_at")
    .eq("id", input.connection_id)
    .maybeSingle();

  const lastSyncAt = (connection?.calendar_last_synced_at ?? connection?.last_successful_sync_at) as string | null;
  if (!input.force && lastSyncAt) {
    const age = Date.now() - new Date(lastSyncAt).getTime();
    if (age < freshnessMs) {
      return { acquired: false, reason: "fresh", last_sync_at: lastSyncAt };
    }
  }

  const existing = await getActiveLease(admin, leaseKey);
  if (existing) {
    return { acquired: false, reason: "already_active", lease: existing };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttl_ms ?? DEFAULT_LEASE_TTL_MS));
  const row = {
    lease_key: leaseKey,
    connection_id: input.connection_id,
    sync_type: "calendar_freshness",
    run_id: input.run_id ?? null,
    owner: input.owner ?? null,
    acquired_at: now.toISOString(),
    heartbeat_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    status: "active",
    sync_reason: input.sync_reason,
    counters: { google_api_calls: 0, ai_calls: 0, firecrawl_calls: 0, gmail_calls: 0 },
    error: null,
  };

  const { data, error } = await admin
    .from("google_sync_leases")
    .upsert(row, { onConflict: "lease_key" })
    .select("*")
    .single();

  if (error) {
    const active = await getActiveLease(admin, leaseKey);
    if (active) return { acquired: false, reason: "already_active", lease: active };
    throw new Error(error.message);
  }

  return { acquired: true, lease: data as GoogleSyncLeaseRow };
}

export async function releaseSyncLease(
  admin: SupabaseClient,
  leaseKey: string,
  patch: {
    status?: "completed" | "failed" | "expired";
    counters?: Record<string, unknown>;
    error?: string | null;
  } = {},
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("google_sync_leases")
    .update({
      status: patch.status ?? "completed",
      counters: patch.counters,
      error: patch.error ?? null,
      heartbeat_at: now,
      updated_at: now,
    })
    .eq("lease_key", leaseKey)
    .eq("status", "active");
}

export async function touchSyncLease(
  admin: SupabaseClient,
  leaseKey: string,
  counters?: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { heartbeat_at: now, updated_at: now };
  if (counters) patch.counters = counters;
  await admin.from("google_sync_leases").update(patch).eq("lease_key", leaseKey).eq("status", "active");
}

export async function getCalendarFreshnessMeta(
  admin: SupabaseClient,
  connectionId: string,
): Promise<{
  calendar_last_synced_at: string | null;
  is_stale: boolean;
  active_lease: GoogleSyncLeaseRow | null;
  freshness_ms: number;
}> {
  const { data: connection } = await admin
    .from("user_google_connections")
    .select("calendar_last_synced_at, last_successful_sync_at")
    .eq("id", connectionId)
    .maybeSingle();

  const lastSync = (connection?.calendar_last_synced_at ?? connection?.last_successful_sync_at) as string | null;
  const age = lastSync ? Date.now() - new Date(lastSync).getTime() : Number.POSITIVE_INFINITY;
  const activeLease = await getActiveLease(admin, calendarLeaseKey(connectionId));

  return {
    calendar_last_synced_at: lastSync,
    is_stale: age >= CALENDAR_FRESHNESS_MS,
    active_lease: activeLease,
    freshness_ms: CALENDAR_FRESHNESS_MS,
  };
}
