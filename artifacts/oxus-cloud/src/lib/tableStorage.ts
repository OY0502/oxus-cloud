const STORAGE_PREFIX = "oxus-table-columns:";

export function loadColumnWidths(tableId: string): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${tableId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, number>;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function saveColumnWidths(tableId: string, widths: Record<string, number>): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${tableId}`, JSON.stringify(widths));
  } catch {
    // Ignore quota / private browsing errors
  }
}
