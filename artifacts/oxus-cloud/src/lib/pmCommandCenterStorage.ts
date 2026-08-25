const COLLAPSED_KEY = "oxus:projects:pm-command-center-collapsed";
const MANUAL_PREF_KEY = "oxus:projects:pm-command-center-manual-pref";

export interface PmCommandCenterCollapseState {
  collapsed: boolean;
  manual: boolean;
}

export function readPmCommandCenterCollapseState(): PmCommandCenterCollapseState | null {
  try {
    const manualRaw = localStorage.getItem(MANUAL_PREF_KEY);
    const collapsedRaw = localStorage.getItem(COLLAPSED_KEY);
    if (manualRaw === "true" && collapsedRaw !== null) {
      return { collapsed: collapsedRaw === "true", manual: true };
    }
    if (collapsedRaw !== null) {
      return { collapsed: collapsedRaw === "true", manual: false };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writePmCommandCenterCollapseState(collapsed: boolean, manual: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    localStorage.setItem(MANUAL_PREF_KEY, String(manual));
  } catch {
    /* ignore */
  }
}
