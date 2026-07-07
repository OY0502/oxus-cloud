import type { KnowledgeSyncStatus, ProjectKnowledgeSource } from "@/lib/types";

export function isActiveKnowledgeSource(source: Pick<ProjectKnowledgeSource, "sync_status">): boolean {
  return (source.sync_status ?? "active") === "active";
}

export function isExcludedKnowledgeSource(source: Pick<ProjectKnowledgeSource, "sync_status">): boolean {
  const status = (source.sync_status ?? "active") as KnowledgeSyncStatus;
  return status === "out_of_scope" || status === "unknown_scope" || status === "archived" || status === "deleted";
}

export function knowledgeSyncStatusLabel(status: KnowledgeSyncStatus | null | undefined): string {
  switch (status ?? "active") {
    case "out_of_scope":
      return "Out of scope";
    case "unknown_scope":
      return "Unknown scope";
    case "archived":
      return "Archived";
    case "deleted":
      return "Deleted";
    default:
      return "Active";
  }
}
