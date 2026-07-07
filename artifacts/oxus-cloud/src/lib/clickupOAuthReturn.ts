const STORAGE_KEY = "oxus_clickup_oauth_return";

export type ClickupOAuthReturnIntent =
  | { projectId: string; kind: "pm_action"; itemId: string }
  | { projectId: string; kind: "ai_proposed_task"; itemId: string };

export function saveClickupOAuthReturnIntent(intent: ClickupOAuthReturnIntent): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
}

export function clearClickupOAuthReturnIntent(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function peekClickupOAuthReturnIntent(projectId: string): ClickupOAuthReturnIntent | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const intent = JSON.parse(raw) as ClickupOAuthReturnIntent;
    if (intent.projectId !== projectId) return null;
    return intent;
  } catch {
    clearClickupOAuthReturnIntent();
    return null;
  }
}

export function consumeClickupOAuthReturnIntent(projectId: string): ClickupOAuthReturnIntent | null {
  const intent = peekClickupOAuthReturnIntent(projectId);
  if (intent) clearClickupOAuthReturnIntent();
  return intent;
}

export function projectClickupOAuthReturnPath(projectId: string): string {
  return `/projects/${projectId}?clickup=connected`;
}

export function stripClickupConnectedSearchParam(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("clickup")) return;
  params.delete("clickup");
  params.delete("message");
  const search = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
}
