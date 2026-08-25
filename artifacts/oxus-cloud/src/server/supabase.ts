import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

function createServiceClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Trigger.dev runs Node 21 — no native WebSocket; supabase-js realtime needs `ws`.
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
}

export function getServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  return createServiceClient(url, key);
}
/** Invoke internal edge function workers from Trigger.dev with backend authentication. */
export async function invokeAgentWorker(path: string, body: Record<string, unknown>): Promise<Response> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const workerSecret = process.env.GOOGLE_SYNC_WORKER_SECRET?.trim();
  if (!url || !key) throw new Error("Missing Supabase env for worker invoke.");

  const authCredential = workerSecret || key;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authCredential}`,
    apikey: key,
  };
  if (workerSecret) {
    headers["x-oxus-internal-secret"] = workerSecret;
  }
  if (body.correlation_id) {
    headers["x-correlation-id"] = String(body.correlation_id);
  }

  return fetch(`${url}/functions/v1/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
