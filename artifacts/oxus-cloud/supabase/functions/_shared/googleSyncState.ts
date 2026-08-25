import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  type GoogleConnectionRow,
} from "./google-auth.ts";
import { resolvePersonByEmail } from "./crmEntityResolution.ts";
import { processContactFromGoogle, computeContactConfidence } from "./crmGoogleEntityProcessing.ts";
import { classifyGoogleInteraction } from "./googleRelationshipAi.ts";

export type SyncCounts = Record<string, number>;

export function bump(counts: SyncCounts, key: string, n = 1) {
  counts[key] = (counts[key] ?? 0) + n;
}

export async function upsertSyncState(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  source: string,
  resourceKey: string,
  patch: Record<string, unknown>,
) {
  await admin.from("google_sync_states").upsert(
    {
      connection_id: connection.id,
      owner_user_id: connection.user_id,
      source,
      resource_key: resourceKey,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,source,resource_key" },
  );
}

export async function processContactSignal(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  contact: {
    email: string;
    displayName: string;
    jobTitle: string | null;
    orgName: string | null;
    resourceName: string;
    emails: string[];
  },
  counts: SyncCounts,
) {
  const personMatch = await resolvePersonByEmail(admin, contact.email);
  const baseConfidence = computeContactConfidence({
    email: contact.email,
    displayName: contact.displayName,
    orgName: contact.orgName,
    hasExistingPerson: !!(personMatch && personMatch.confidence >= 0.9),
  });

  let aiConfidence: number | undefined;
  let relationshipType: string | null = null;
  if (baseConfidence < 0.9 && baseConfidence >= 0.5) {
    const classification = await classifyGoogleInteraction({
      interactionType: "contact",
      subject: contact.displayName,
      snippet: [contact.orgName, contact.jobTitle].filter(Boolean).join(" — "),
      participantEmails: contact.emails,
      trace: { connection_id: connection.id, email: contact.email },
    });
    aiConfidence = classification.confidence;
    relationshipType = classification.person_relationship;
  }

  await processContactFromGoogle(admin, connection, contact, counts, {
    aiConfidence,
    relationshipType,
  });
}
