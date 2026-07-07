import { getSlackApiBaseUrl } from "./slack-auth.ts";

const SLACK_MAX_AGE_SECONDS = 60 * 5;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function verifySlackSignature(req: Request, rawBody: string): Promise<boolean> {
  const signingSecret = Deno.env.get("SLACK_SIGNING_SECRET")?.trim();
  if (!signingSecret) return false;

  const timestamp = req.headers.get("X-Slack-Request-Timestamp") ?? "";
  const signature = req.headers.get("X-Slack-Signature") ?? "";
  if (!timestamp || !signature) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SLACK_MAX_AGE_SECONDS) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  const computed = `v0=${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  return timingSafeEqual(computed, signature);
}

export async function callSlackApi<T = Record<string, unknown>>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const baseUrl = getSlackApiBaseUrl();
  const apiMethod = method.replace(/^GET\s+/, "");
  const useGet = method.startsWith("GET ");

  const params = new URLSearchParams();
  if (payload) {
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
  }

  const resp = await fetch(
    useGet && payload ? `${baseUrl}/${apiMethod}?${params.toString()}` : `${baseUrl}/${apiMethod}`,
    {
      method: useGet ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(useGet ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
      },
      ...(useGet ? {} : { body: params.toString() }),
    },
  );

  const text = await resp.text();
  let data: T & { ok?: boolean; error?: string };
  try {
    data = JSON.parse(text) as T & { ok?: boolean; error?: string };
  } catch {
    throw new Error(`Slack API ${apiMethod} returned invalid JSON: ${text.slice(0, 400)}`);
  }
  if (!resp.ok || data.ok === false) {
    throw new Error(`Slack API ${apiMethod} failed: ${data.error ?? text.slice(0, 400)}`);
  }
  return data;
}

export function suggestLinkType(channel: {
  is_ext_shared?: boolean;
  is_shared?: boolean;
}): "internal" | "external" {
  if (channel.is_ext_shared || channel.is_shared) return "external";
  return "internal";
}

export type SlackChannelListItem = Record<string, unknown>;

function normalizeSlackChannel(ch: SlackChannelListItem) {
  return {
    id: String(ch.id ?? ""),
    name: String(ch.name ?? ch.id ?? ""),
    is_private: !!ch.is_private,
    is_archived: !!ch.is_archived,
    is_member: !!ch.is_member,
    is_shared: !!ch.is_shared,
    is_ext_shared: !!ch.is_ext_shared,
    is_org_shared: !!ch.is_org_shared,
    num_members: typeof ch.num_members === "number" ? ch.num_members : null,
    suggested_link_type: suggestLinkType({
      is_ext_shared: !!ch.is_ext_shared,
      is_shared: !!ch.is_shared,
    }),
  };
}

async function paginateSlackChannels(
  token: string,
  method: "conversations.list" | "users.conversations",
  params: Record<string, unknown>,
): Promise<SlackChannelListItem[]> {
  const channels: SlackChannelListItem[] = [];
  let cursor: string | undefined;

  do {
    const resp = await callSlackApi<{
      channels?: SlackChannelListItem[];
      response_metadata?: { next_cursor?: string };
    }>(token, method, {
      ...params,
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    channels.push(...(resp.channels ?? []));
    const next = resp.response_metadata?.next_cursor?.trim();
    cursor = next ? next : undefined;
  } while (cursor);

  return channels;
}

async function resolveBotUserId(
  token: string,
  storedBotUserId?: string | null,
): Promise<string | null> {
  if (storedBotUserId?.trim()) return storedBotUserId.trim();
  try {
    const auth = await callSlackApi<{ user_id?: string }>(token, "auth.test", {});
    return typeof auth.user_id === "string" ? auth.user_id : null;
  } catch {
    return null;
  }
}

async function fetchChannelById(
  token: string,
  channelId: string,
): Promise<SlackChannelListItem | null> {
  try {
    const resp = await callSlackApi<{ channel?: SlackChannelListItem }>(token, "conversations.info", {
      channel: channelId,
    });
    const channel = resp.channel;
    if (!channel?.id) return null;
    if (channel.is_archived) return null;
    // Private channels require bot membership; public channels are linkable either way.
    if (channel.is_private && !channel.is_member) return null;
    return channel;
  } catch {
    return null;
  }
}

export type ListSlackChannelsResult = {
  channels: ReturnType<typeof normalizeSlackChannel>[];
  resolvedBotUserId: string | null;
};

/** List workspace channels the bot can access (includes private channels the bot was invited to). */
export async function listSlackChannelsForBot(
  token: string,
  options: {
    botUserId?: string | null;
    includePrivate?: boolean;
    ensureChannelIds?: string[];
  },
): Promise<ListSlackChannelsResult> {
  const types =
    options.includePrivate !== false ? "public_channel,private_channel" : "public_channel";

  const byId = new Map<string, SlackChannelListItem>();
  const resolvedBotUserId = await resolveBotUserId(token, options.botUserId);

  for (const ch of await paginateSlackChannels(token, "conversations.list", { types })) {
    if (ch.id) byId.set(String(ch.id), ch);
  }

  if (options.includePrivate !== false) {
    // Bot tokens: omit `user` so Slack lists the bot's own conversations.
    try {
      for (const ch of await paginateSlackChannels(token, "users.conversations", { types })) {
        if (ch.id) byId.set(String(ch.id), ch);
      }
    } catch (primaryErr) {
      console.warn("[listSlackChannelsForBot] users.conversations failed:", (primaryErr as Error).message);
      if (resolvedBotUserId) {
        try {
          for (const ch of await paginateSlackChannels(token, "users.conversations", {
            user: resolvedBotUserId,
            types,
          })) {
            if (ch.id) byId.set(String(ch.id), ch);
          }
        } catch (fallbackErr) {
          console.warn(
            "[listSlackChannelsForBot] users.conversations fallback failed:",
            (fallbackErr as Error).message,
          );
        }
      }
    }
  }

  for (const channelId of options.ensureChannelIds ?? []) {
    const trimmed = channelId.trim();
    if (!trimmed) continue;
    const channel = await fetchChannelById(token, trimmed);
    if (channel?.id) byId.set(String(channel.id), channel);
  }

  const channels = [...byId.values()]
    .map(normalizeSlackChannel)
    .filter((ch) => ch.id)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return { channels, resolvedBotUserId };
}

export function messagePreview(text: string | null | undefined, max = 240): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
