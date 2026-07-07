/** Extract Slack file/image attachment metadata from event raw_payload (no downloads). */

export type SlackAttachmentMeta = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  thumb_width?: number;
  thumb_height?: number;
  is_image?: boolean;
  permalink?: string;
};

export function extractSlackAttachments(rawPayload: Record<string, unknown> | null | undefined): SlackAttachmentMeta[] {
  if (!rawPayload) return [];

  const attachments: SlackAttachmentMeta[] = [];
  const files = rawPayload.files;
  if (Array.isArray(files)) {
    for (const file of files) {
      if (!file || typeof file !== "object") continue;
      const f = file as Record<string, unknown>;
      const mimetype = typeof f.mimetype === "string" ? f.mimetype : undefined;
      attachments.push({
        id: typeof f.id === "string" ? f.id : undefined,
        name: typeof f.name === "string" ? f.name : undefined,
        title: typeof f.title === "string" ? f.title : undefined,
        mimetype,
        filetype: typeof f.filetype === "string" ? f.filetype : undefined,
        size: typeof f.size === "number" ? f.size : undefined,
        thumb_width: typeof f.thumb_360_w === "number" ? f.thumb_360_w : undefined,
        thumb_height: typeof f.thumb_360_h === "number" ? f.thumb_360_h : undefined,
        is_image: mimetype?.startsWith("image/") ?? false,
        // Do not store url_private — tokenized; use id/name for reference only
        permalink: typeof f.permalink === "string" ? f.permalink : undefined,
      });
    }
  }

  const messageAttachments = rawPayload.attachments;
  if (Array.isArray(messageAttachments)) {
    for (const att of messageAttachments) {
      if (!att || typeof att !== "object") continue;
      const a = att as Record<string, unknown>;
      if (typeof a.image_url === "string" || typeof a.title === "string") {
        attachments.push({
          title: typeof a.title === "string" ? a.title : undefined,
          name: typeof a.fallback === "string" ? a.fallback : undefined,
          is_image: typeof a.image_url === "string",
        });
      }
    }
  }

  return attachments;
}

export function hasSlackAttachments(rawPayload: Record<string, unknown> | null | undefined): boolean {
  return extractSlackAttachments(rawPayload).length > 0;
}
