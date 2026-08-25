export const CRM_RESOLVER_VERSION = 2;

export const RESOLVER_STAGES = [
  "sync_source_evidence",
  "normalize_source_identities",
  "resolve_people",
  "resolve_companies",
  "resolve_associations",
  "publish_canonical_entities",
  "rebuild_activities",
  "classify_relationships",
  "resolve_photos_and_logos",
  "queue_uncertain_records",
  "completed",
] as const;

export type ResolverStage = (typeof RESOLVER_STAGES)[number];

export type ResolverRunRow = {
  id: string;
  run_key: string;
  owner_user_id: string;
  connection_id: string | null;
  run_type: string;
  crm_resolver_version: number;
  current_stage: ResolverStage;
  stage_checkpoint: Record<string, unknown>;
  status: string;
  processed_count: number;
  failed_count: number;
  skipped_count: number;
  report: Record<string, unknown>;
};

export type PipelineCounts = {
  processed: number;
  failed: number;
  skipped: number;
};

export type AttendeeExclusion =
  | "internal_oxus"
  | "connected_self"
  | "invalid_email"
  | "automated_sender"
  | "role_inbox"
  | "resource_calendar"
  | "room_calendar"
  | "bot"
  | null;
