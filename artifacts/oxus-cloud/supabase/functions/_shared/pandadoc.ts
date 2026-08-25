/**
 * Server-only PandaDoc API client.
 * Never import this into browser code. Never log API keys.
 */

const DEFAULT_API_BASE = "https://api.pandadoc.com/public/v1";
const DEFAULT_APP_URL = "https://app.pandadoc.com";
const DEFAULT_TIMEOUT_MS = 25_000;

export class PandaDocError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: string,
  ) {
    super(message);
    this.name = "PandaDocError";
  }
}

export type NormalizedPandaDocRecipient = {
  name?: string;
  email?: string;
  role?: string;
};

export type NormalizedPandaDocDocument = {
  external_id: string;
  name: string;
  status: string;
  date_created?: string;
  date_modified?: string;
  date_sent?: string;
  date_completed?: string;
  owner_name?: string;
  recipients?: NormalizedPandaDocRecipient[];
  folder_id?: string;
  external_url?: string;
  metadata: Record<string, unknown>;
};

export function getPandaDocApiKey(): string | null {
  return Deno.env.get("PANDADOC_API_KEY")?.trim() || null;
}

export function getPandaDocApiBaseUrl(): string {
  return Deno.env.get("PANDADOC_API_BASE_URL")?.trim() || DEFAULT_API_BASE;
}

export function getPandaDocAppUrl(): string {
  return Deno.env.get("PANDADOC_APP_URL")?.trim() || DEFAULT_APP_URL;
}

export function getPandaDocWebhookSharedKey(): string | null {
  return Deno.env.get("PANDADOC_WEBHOOK_SHARED_KEY")?.trim() || null;
}

export function isPandaDocConfigured(): boolean {
  return !!getPandaDocApiKey();
}

export function buildPandaDocExternalUrl(documentId: string): string {
  const base = getPandaDocAppUrl().replace(/\/$/, "");
  return `${base}/a/#/documents/${documentId}`;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function asIso(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString();
}

export function normalizePandaDocDocument(raw: Record<string, unknown>): NormalizedPandaDocDocument {
  const id = asString(raw.id) ?? asString(raw.uuid);
  if (!id) {
    throw new PandaDocError("PandaDoc document missing id.", 502, "PANDADOC_INVALID_RESPONSE");
  }

  const name = asString(raw.name) ?? asString(raw.title) ?? "Untitled document";
  const status = asString(raw.status) ?? "unknown";

  const recipientsRaw = Array.isArray(raw.recipients) ? raw.recipients : [];
  const recipients: NormalizedPandaDocRecipient[] = recipientsRaw
    .map((r) => {
      if (!r || typeof r !== "object") return null;
      const row = r as Record<string, unknown>;
      return {
        name: asString(row.first_name)
          ? `${asString(row.first_name)}${asString(row.last_name) ? ` ${asString(row.last_name)}` : ""}`.trim()
          : asString(row.name),
        email: asString(row.email),
        role: asString(row.role) ?? asString(row.recipient_type),
      };
    })
    .filter((r): r is NormalizedPandaDocRecipient => !!r && (!!r.email || !!r.name));

  const createdBy = raw.created_by && typeof raw.created_by === "object"
    ? (raw.created_by as Record<string, unknown>)
    : null;

  let ownerName = asString(raw.owner);
  if (createdBy) {
    const composed = [asString(createdBy.first_name), asString(createdBy.last_name)]
      .filter(Boolean)
      .join(" ");
    ownerName = asString(createdBy.email) ?? (composed || undefined);
  }

  return {
    external_id: id,
    name,
    status,
    date_created: asIso(raw.date_created) ?? asIso(raw.created),
    date_modified: asIso(raw.date_modified) ?? asIso(raw.modified),
    date_sent: asIso(raw.date_sent) ?? asIso(raw.sent),
    date_completed: asIso(raw.date_completed) ?? asIso(raw.completed),
    owner_name: ownerName,
    recipients: recipients.length ? recipients : undefined,
    folder_id: asString(raw.folder_uuid) ?? asString(raw.folder_id),
    external_url: buildPandaDocExternalUrl(id),
    metadata: {
      version: raw.version ?? null,
      template_uuid: raw.template_uuid ?? null,
      expiration_date: raw.expiration_date ?? null,
    },
  };
}

export async function pandadocFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const apiKey = getPandaDocApiKey();
  if (!apiKey) {
    throw new PandaDocError(
      "PandaDoc is not configured. Set PANDADOC_API_KEY.",
      503,
      "PANDADOC_NOT_CONFIGURED",
    );
  }

  const base = getPandaDocApiBaseUrl().replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `API-Key ${apiKey}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    headers.set("Accept", "application/json");

    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new PandaDocError(
        "PandaDoc rate limit exceeded. Try again shortly.",
        429,
        "PANDADOC_RATE_LIMITED",
      );
    }

    return response;
  } catch (e) {
    if (e instanceof PandaDocError) throw e;
    if ((e as Error).name === "AbortError") {
      throw new PandaDocError("PandaDoc request timed out.", 504, "PANDADOC_TIMEOUT");
    }
    throw new PandaDocError(
      "PandaDoc request failed.",
      502,
      "PANDADOC_REQUEST_FAILED",
      (e as Error).message,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function pandadocJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await pandadocFetch(path, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const detail =
      body && typeof body === "object"
        ? JSON.stringify(body).slice(0, 800)
        : text.slice(0, 800);
    throw new PandaDocError(
      `PandaDoc API error (${response.status}).`,
      response.status >= 400 && response.status < 600 ? response.status : 502,
      "PANDADOC_API_ERROR",
      detail,
    );
  }

  return body as T;
}

export async function listPandaDocDocuments(args: {
  query?: string;
  status?: string;
  page?: number;
  count?: number;
}): Promise<{ results: NormalizedPandaDocDocument[]; page: number; count: number }> {
  const page = Math.max(1, args.page ?? 1);
  const count = Math.min(100, Math.max(1, args.count ?? 20));
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("count", String(count));
  params.set("order_by", "date_created");
  if (args.query?.trim()) params.set("q", args.query.trim());
  if (args.status?.trim()) params.set("status", args.status.trim());

  const data = await pandadocJson<Record<string, unknown>>(`/documents?${params.toString()}`);
  const rows = Array.isArray(data.results)
    ? data.results
    : Array.isArray(data.documents)
      ? data.documents
      : [];

  const results = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => normalizePandaDocDocument(r));

  return { results, page, count };
}

export async function getPandaDocDocument(documentId: string): Promise<NormalizedPandaDocDocument> {
  const data = await pandadocJson<Record<string, unknown>>(`/documents/${encodeURIComponent(documentId)}`);
  return normalizePandaDocDocument(data);
}

export async function testPandaDocConnection(): Promise<{
  ok: boolean;
  workspace_name: string | null;
  sample_count: number;
}> {
  const listed = await listPandaDocDocuments({ page: 1, count: 1 });
  return {
    ok: true,
    workspace_name: "PandaDoc workspace",
    sample_count: listed.results.length,
  };
}

/**
 * Official PandaDoc webhook verification:
 * HMAC-SHA256 of the raw request body with the subscription shared key,
 * compared to the `signature` query parameter (hex digest).
 * @see https://developers.pandadoc.com/docs/webhook-verification
 */
export async function verifyPandaDocWebhookSignatureAsync(
  sharedKey: string,
  rawBody: string,
  receivedSignature: string | null,
): Promise<boolean> {
  if (!receivedSignature?.trim()) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(sharedKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
    const expected = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const a = enc.encode(expected);
    const b = enc.encode(receivedSignature.trim().toLowerCase());
    if (a.length !== b.length) return false;

    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
    return diff === 0;
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Human-readable timeline titles for meaningful status transitions. */
export function pandadocStatusTimelineCopy(
  docType: string,
  status: string,
  documentName: string,
): { title: string; summary: string } | null {
  const kind =
    docType === "msa" ? "MSA"
      : docType === "nda" ? "NDA"
        : docType === "sow" ? "SOW"
          : "Document";
  const normalized = status.toLowerCase().replace(/^document\./, "");

  if (normalized === "document.sent" || normalized === "sent") {
    return { title: `${kind} sent for signature`, summary: `"${documentName}" was sent.` };
  }
  if (normalized === "document.viewed" || normalized === "viewed") {
    return { title: `${kind} viewed`, summary: `"${documentName}" was viewed.` };
  }
  if (normalized === "document.completed" || normalized === "completed") {
    return { title: `${kind} completed`, summary: `"${documentName}" was completed.` };
  }
  if (normalized === "document.declined" || normalized === "declined" || normalized === "rejected") {
    return { title: `${kind} declined`, summary: `"${documentName}" was declined.` };
  }
  if (normalized === "document.voided" || normalized === "voided") {
    return { title: `${kind} voided`, summary: `"${documentName}" was voided.` };
  }
  return null;
}
