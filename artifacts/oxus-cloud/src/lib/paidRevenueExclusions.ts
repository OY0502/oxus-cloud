const STORAGE_PREFIX = "oxus-paid-revenue-excluded:";

export function loadPaidRevenueExclusions(monthKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${monthKey}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function savePaidRevenueExclusions(monthKey: string, ids: Set<string>): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${monthKey}`, JSON.stringify([...ids]));
  } catch {
    // Ignore quota / private browsing errors
  }
}
