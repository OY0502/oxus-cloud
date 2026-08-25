import { isServiceRoleRequest } from "./serviceRoleAuth.ts";

export type InternalWorkerAuthResult =
  | { ok: true; method: "worker_secret" | "service_role" }
  | { ok: false; code: "INTERNAL_AUTH_MISSING" | "INTERNAL_AUTH_INVALID" };

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization")?.trim() ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function extractWorkerSecret(req: Request): string | null {
  const headerSecret = req.headers.get("x-oxus-internal-secret")?.trim();
  if (headerSecret) return headerSecret;
  return extractBearerToken(req);
}

/**
 * Authenticate trusted backend callers (Trigger.dev, cron, etc.).
 * Prefers a dedicated worker secret; falls back to project service-role credential.
 */
export async function authenticateInternalWorker(
  req: Request,
  secretEnvName = "GOOGLE_SYNC_WORKER_SECRET",
): Promise<InternalWorkerAuthResult> {
  const expectedSecret = Deno.env.get(secretEnvName)?.trim();
  const presentedSecret = extractWorkerSecret(req);

  if (expectedSecret && presentedSecret && constantTimeEqual(presentedSecret, expectedSecret)) {
    return { ok: true, method: "worker_secret" };
  }

  if (await isServiceRoleRequest(req)) {
    return { ok: true, method: "service_role" };
  }

  if (!presentedSecret) return { ok: false, code: "INTERNAL_AUTH_MISSING" };
  return { ok: false, code: "INTERNAL_AUTH_INVALID" };
}

export function internalWorkerAuthErrorResponse(
  code: "INTERNAL_AUTH_MISSING" | "INTERNAL_AUTH_INVALID",
  correlationId: string,
  corsHeaders: Record<string, string>,
): Response {
  const message =
    code === "INTERNAL_AUTH_MISSING"
      ? "Internal worker authentication required."
      : "Internal worker authentication failed.";
  return new Response(
    JSON.stringify({ error: message, code, correlation_id: correlationId }),
    {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
