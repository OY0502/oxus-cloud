function extractTextFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (typeof record.text === "object" && record.text !== null) {
      const textObj = record.text as Record<string, unknown>;
      if (typeof textObj.text === "string") parts.push(textObj.text);
    }
    if (Array.isArray(record.elements)) {
      for (const element of record.elements) {
        if (element && typeof element === "object") {
          const el = element as Record<string, unknown>;
          if (typeof el.text === "string") parts.push(el.text);
        }
      }
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function resolveSlackEventMessageText(event: {
  message_text?: string | null;
  message_preview?: string | null;
  raw_payload?: Record<string, unknown> | null;
}): string {
  const direct = (event.message_text ?? "").replace(/\s+/g, " ").trim();
  if (direct.length >= 2) return direct;

  const preview = (event.message_preview ?? "").replace(/\s+/g, " ").trim();
  if (preview.length >= 2) return preview;

  const raw = event.raw_payload ?? {};
  if (typeof raw.text === "string" && raw.text.trim().length >= 2) {
    return raw.text.replace(/\s+/g, " ").trim();
  }

  const fromBlocks = extractTextFromBlocks(raw.blocks);
  if (fromBlocks.length >= 2) return fromBlocks;

  return direct || preview || fromBlocks;
}

export function resolveSlackApiMessageText(message: Record<string, unknown>): string {
  const text = typeof message.text === "string" ? message.text.replace(/\s+/g, " ").trim() : "";
  if (text.length >= 2) return text;
  return extractTextFromBlocks(message.blocks);
}
