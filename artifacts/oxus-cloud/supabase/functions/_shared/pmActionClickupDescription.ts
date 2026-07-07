type AttachmentMeta = {
  name?: string | null;
  title?: string | null;
  mimetype?: string | null;
  filetype?: string | null;
  size?: number | null;
};

export function buildPmActionClickupMarkdown(args: {
  title: string;
  description?: string | null;
  sourceType?: string | null;
  sourceApp?: string | null;
  sourceMessage?: string | null;
  channelName?: string | null;
  actorName?: string | null;
  messageTs?: string | null;
  attachments?: unknown;
  projectName?: string | null;
  projectId?: string | null;
}): string {
  const lines: string[] = [];

  if (args.description?.trim()) {
    lines.push("## Description", args.description.trim(), "");
  }

  const sourceLabel = args.sourceApp ?? args.sourceType ?? "Unknown";
  lines.push("## Source", `- **Origin:** ${sourceLabel}`);

  if (args.sourceMessage?.trim()) {
    lines.push("", "### Original message", `> ${args.sourceMessage.trim().replace(/\n/g, "\n> ")}`);
  }
  if (args.channelName) lines.push(`- **Channel:** #${args.channelName}`);
  if (args.actorName) lines.push(`- **From:** ${args.actorName}`);
  if (args.messageTs) {
    try {
      lines.push(`- **When:** ${new Date(args.messageTs).toISOString()}`);
    } catch {
      lines.push(`- **When:** ${args.messageTs}`);
    }
  }

  const attachments = normalizeAttachments(args.attachments);
  if (attachments.length > 0) {
    lines.push("", "### Attachments (metadata only)");
    for (const att of attachments) {
      const name = att.name ?? att.title ?? "Attachment";
      const mime = att.mimetype ?? att.filetype ?? "unknown type";
      const size = att.size != null ? ` · ${att.size} bytes` : "";
      lines.push(`- ${name} (${mime})${size}`);
    }
    lines.push("_Slack attachment metadata captured — file not downloaded._");
  }

  if (args.projectName) {
    lines.push("", `---`, `_OXUS project: ${args.projectName}_`);
  }

  lines.push("_Created by OXUS Cloud from a PM action — do not edit this line._");
  return lines.join("\n");
}

function normalizeAttachments(raw: unknown): AttachmentMeta[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      return {
        name: typeof row.name === "string" ? row.name : null,
        title: typeof row.title === "string" ? row.title : null,
        mimetype: typeof row.mimetype === "string" ? row.mimetype : null,
        filetype: typeof row.filetype === "string" ? row.filetype : null,
        size: typeof row.size === "number" ? row.size : null,
      };
    })
    .filter((item): item is AttachmentMeta => item !== null);
}
