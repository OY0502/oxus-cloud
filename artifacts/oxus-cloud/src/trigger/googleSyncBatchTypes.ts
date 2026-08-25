export type GoogleSyncBatchAction =

  | "validate"

  | "contacts_page"

  | "calendar_page"

  | "gmail_discover_page"

  | "resolve_basic_entities"

  | "resolve_entities"

  | "complete_core_sync"

  | "filter_enrichment_threads"

  | "group_relationships"

  | "enrich_relationship_batch"

  | "gmail_process_batch"

  | "reconcile_reset"

  | "enrich_companies"
  | "finalize";
