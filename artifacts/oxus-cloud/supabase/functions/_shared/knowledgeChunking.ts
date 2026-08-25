export type KnowledgeChunk = {
  content: string;
  sectionPath: string | null;
  charStart: number;
  charEnd: number;
  tokenEstimate: number;
};

export type KnowledgeChunkingOptions = {
  targetChars?: number;
  overlapChars?: number;
};

const DEFAULT_TARGET_CHARS = 2_600;
const DEFAULT_OVERLAP_CHARS = 320;
const MIN_TARGET_CHARS = 800;
const MAX_TARGET_CHARS = 8_000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function headingLevel(line: string): number | null {
  const match = line.match(/^\s{0,3}(#{1,6})\s+\S/);
  return match ? match[1].length : null;
}

function cleanHeading(line: string): string {
  return line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim();
}

function preferredBreak(text: string, start: number, targetEnd: number): number {
  if (targetEnd >= text.length) return text.length;
  const minimum = Math.min(text.length, start + Math.floor((targetEnd - start) * 0.62));
  const window = text.slice(minimum, targetEnd);
  const candidates = [
    window.lastIndexOf("\n\n") >= 0 ? window.lastIndexOf("\n\n") + 2 : -1,
    window.lastIndexOf("\n") >= 0 ? window.lastIndexOf("\n") + 1 : -1,
    window.lastIndexOf(". ") >= 0 ? window.lastIndexOf(". ") + 2 : -1,
    window.lastIndexOf("? ") >= 0 ? window.lastIndexOf("? ") + 2 : -1,
    window.lastIndexOf("! ") >= 0 ? window.lastIndexOf("! ") + 2 : -1,
    window.lastIndexOf(" ") >= 0 ? window.lastIndexOf(" ") + 1 : -1,
  ];
  const best = Math.max(...candidates);
  return best > 0 ? minimum + best : targetEnd;
}

function sectionAt(text: string, offset: number): string | null {
  const headings: Array<string | undefined> = [];
  let cursor = 0;
  for (const line of text.split("\n")) {
    if (cursor > offset) break;
    const level = headingLevel(line);
    if (level) {
      headings[level - 1] = cleanHeading(line);
      headings.length = level;
    }
    cursor += line.length + 1;
  }
  const path = headings.filter((value): value is string => !!value).join(" > ");
  return path || null;
}

/**
 * Split durable knowledge into passage-sized, boundary-aware chunks. The
 * chunker keeps Markdown headings as section provenance and overlaps only a
 * small tail so answers can recover facts that straddle a boundary.
 */
export function chunkKnowledgeText(
  rawText: string,
  options: KnowledgeChunkingOptions = {},
): KnowledgeChunk[] {
  const text = rawText.replace(/\r\n?/g, "\n").replace(/[\t ]+\n/g, "\n").trim();
  if (!text) return [];

  const targetChars = clamp(
    Number.isFinite(options.targetChars) ? Number(options.targetChars) : DEFAULT_TARGET_CHARS,
    MIN_TARGET_CHARS,
    MAX_TARGET_CHARS,
  );
  const overlapChars = clamp(
    Number.isFinite(options.overlapChars) ? Number(options.overlapChars) : DEFAULT_OVERLAP_CHARS,
    0,
    Math.floor(targetChars * 0.2),
  );

  const chunks: KnowledgeChunk[] = [];
  let start = 0;
  while (start < text.length) {
    const targetEnd = Math.min(start + targetChars, text.length);
    const end = preferredBreak(text, start, targetEnd);
    const content = text.slice(start, end).trim();
    if (content) {
      const leadingWhitespace = text.slice(start, end).search(/\S/);
      const actualStart = start + Math.max(0, leadingWhitespace);
      chunks.push({
        content,
        sectionPath: sectionAt(text, actualStart),
        charStart: actualStart,
        charEnd: actualStart + content.length,
        tokenEstimate: Math.ceil(content.length / 4),
      });
    }
    if (end >= text.length) break;
    const nextStart = Math.max(end - overlapChars, start + 1);
    const overlapWindow = text.slice(nextStart, end);
    const boundary = Math.max(overlapWindow.indexOf("\n\n"), overlapWindow.indexOf(". "));
    start = boundary >= 0 ? nextStart + boundary + (overlapWindow[boundary] === "." ? 2 : 2) : nextStart;
  }

  return chunks;
}

export function contextualizeKnowledgeChunk(args: {
  content: string;
  title?: string | null;
  sectionPath?: string | null;
  sourceType?: string | null;
}): string {
  const headers = [
    args.title?.trim() ? `Document: ${args.title.trim()}` : null,
    args.sectionPath?.trim() ? `Section: ${args.sectionPath.trim()}` : null,
    args.sourceType?.trim() ? `Source type: ${args.sourceType.trim()}` : null,
  ].filter((value): value is string => !!value);
  return headers.length > 0 ? `${headers.join("\n")}\n\n${args.content.trim()}` : args.content.trim();
}
