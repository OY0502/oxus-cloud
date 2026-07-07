export class EdgeFunctionInvokeError extends Error {
  code?: string;
  redirectTo?: string;

  constructor(message: string, code?: string, redirectTo?: string) {
    super(message);
    this.name = "EdgeFunctionInvokeError";
    this.code = code;
    this.redirectTo = redirectTo;
  }
}

export function isClickupOAuthRequired(error: unknown): error is EdgeFunctionInvokeError {
  return error instanceof EdgeFunctionInvokeError && error.code === "CLICKUP_OAUTH_REQUIRED";
}

export function isClickupTeamNotAuthorized(error: unknown): error is EdgeFunctionInvokeError {
  return error instanceof EdgeFunctionInvokeError && error.code === "CLICKUP_TEAM_NOT_AUTHORIZED";
}

export async function parseEdgeFunctionError(error: unknown): Promise<EdgeFunctionInvokeError> {
  const fallback = error instanceof Error ? error.message : "Edge Function request failed.";
  const context = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== "undefined" && context instanceof Response) {
    const bodyText = await context.clone().text();
    if (!bodyText) return new EdgeFunctionInvokeError(fallback);
    try {
      const payload = JSON.parse(bodyText) as {
        error?: string;
        details?: string;
        code?: string;
        redirect_to?: string;
      };
      const message = [payload.error, payload.details, payload.code ? `Code: ${payload.code}` : null]
        .filter(Boolean)
        .join(" ");
      return new EdgeFunctionInvokeError(message || fallback, payload.code, payload.redirect_to);
    } catch {
      return new EdgeFunctionInvokeError(bodyText || fallback);
    }
  }
  return new EdgeFunctionInvokeError(fallback);
}

export async function edgeFunctionErrorMessage(error: unknown): Promise<string> {
  const parsed = await parseEdgeFunctionError(error);
  return parsed.message;
}
