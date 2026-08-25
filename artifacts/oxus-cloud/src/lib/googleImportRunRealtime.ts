import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { GoogleImportRun } from "@/lib/types";

type Listener = (run: GoogleImportRun) => void;

const subscriptions = new Map<
  string,
  { channel: RealtimeChannel; listeners: Set<Listener> }
>();

/**
 * Multiplexes a single Realtime channel per import run so multiple hook
 * instances (CRM page, GoogleConnection, Import Center) can share one subscription.
 */
export function subscribeGoogleImportRun(runId: string, listener: Listener): () => void {
  let entry = subscriptions.get(runId);
  if (!entry) {
    const listeners = new Set<Listener>();
    const channel = supabase
      .channel(`google-import-run:${runId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "google_import_runs",
          filter: `id=eq.${runId}`,
        },
        (payload) => {
          const run = payload.new as GoogleImportRun;
          for (const fn of listeners) fn(run);
        },
      )
      .subscribe();

    entry = { channel, listeners };
    subscriptions.set(runId, entry);
  }

  entry.listeners.add(listener);
  return () => {
    const current = subscriptions.get(runId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      void supabase.removeChannel(current.channel);
      subscriptions.delete(runId);
    }
  };
}
