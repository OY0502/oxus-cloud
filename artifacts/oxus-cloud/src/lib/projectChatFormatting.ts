function cleanItem(value: string): string {
  return value
    .trim()
    .replace(/^and\s+/i, "")
    .replace(/[.;]\s*$/, "")
    .trim();
}

function bulletLines(value: string): string[] {
  return value
    .split(/;\s*/)
    .map(cleanItem)
    .filter(Boolean)
    .map((item) => `- ${item}`);
}

function numberedLines(value: string): string[] {
  return value
    .split(/(?=\d+[.)]\s+)/)
    .map((item) => cleanItem(item.replace(/^\d+[.)]\s+/, "")))
    .filter(Boolean)
    .map((item) => `- ${item}`);
}

const PLAIN_SECTION_HEADINGS: Array<[RegExp, string]> = [
  [/^quick conclusion$/i, "## Slack & ClickUp review"],
  [/^analysis of slack activity(?:\s*\([^)]*\))?$/i, "### What changed"],
  [/^clickup updates recommended(?:\s*\([^)]*\))?$/i, "### ClickUp actions"],
  [/^next meeting\s*&\s*deliverables(?:\s*\([^)]*\))?$/i, "### Next meeting & deliverables"],
  [/^open\s*\/\s*unclear items to resolve now(?:\s*\([^)]*\))?$/i, "### Needs clarification"],
  [/^evidence freshness$/i, "### Source freshness"],
];

function normalizePlainSectionHeadings(value: string): string {
  return value
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const match = PLAIN_SECTION_HEADINGS.find(([pattern]) => pattern.test(trimmed));
      return match ? match[1] : line;
    })
    .join("\n");
}

/**
 * Older agent responses sometimes arrived as one dense paragraph even though
 * they contained recognizable weekly-plan sections. Reshape those messages at
 * render time so existing history benefits from the improved presentation too.
 */
export function structureAssistantMessage(content: string): string {
  const text = normalizePlainSectionHeadings(content.trim());
  if (!text || /\n\s*(?:#{1,4}\s+|[-*]\s+|\d+[.)]\s+)/.test(text)) return text;

  const focus = /^This week \(cycle ([^)]+)\) the team is focused on:\s*/i.exec(text);
  const next = /\s+For the next weekly meeting \((?:scheduled|expected) ([^)]+)\) the confirmed deliverables to show are:\s*/i.exec(text);
  if (focus && next && next.index > focus[0].length) {
    const ready = /\s+Rich Text is finished\b/i.exec(text);
    const missing = /\s+Open\s*\/\s*missing evidence:\s*/i.exec(text);
    const freshness = /\s+Data current as of\s+/i.exec(text);
    const nextEnd = [ready?.index, missing?.index, freshness?.index, text.length]
      .filter((value): value is number => typeof value === "number" && value > next.index)
      .sort((a, b) => a - b)[0] ?? text.length;
    const sections: string[] = [];
    const cycle = focus[1].replace(/\s*→\s*/g, "–");
    sections.push(`## Weekly plan · ${cycle}`);
    sections.push(`### In progress\n${bulletLines(text.slice(focus[0].length, next.index)).join("\n")}`);
    sections.push(`### Next meeting · ${next[1]}\n${numberedLines(text.slice(next.index + next[0].length, nextEnd)).join("\n")}`);

    if (ready) {
      const readyEnd = [missing?.index, freshness?.index, text.length]
        .filter((value): value is number => typeof value === "number" && value > ready.index)
        .sort((a, b) => a - b)[0] ?? text.length;
      const readyText = cleanItem(text.slice(ready.index, readyEnd)).replace(/^Rich Text\s*/i, "");
      sections.push(`### Ready for feedback\n- **Rich Text** ${readyText}`);
    }
    if (missing) {
      const missingEnd = freshness?.index && freshness.index > missing.index ? freshness.index : text.length;
      sections.push(`### Needs clarification\n${bulletLines(text.slice(missing.index + missing[0].length, missingEnd)).join("\n")}`);
    }
    if (freshness) {
      sections.push(`### Source freshness\n${cleanItem(text.slice(freshness.index + freshness[0].length))}`);
    }
    return sections.filter((section) => !section.endsWith("\n")).join("\n\n");
  }

  if (text.length < 300) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [text];
  if (sentences.length < 3) return text;
  const paragraphs: string[] = [];
  for (let index = 0; index < sentences.length; index += 2) {
    paragraphs.push(sentences.slice(index, index + 2).join(" "));
  }
  return paragraphs.join("\n\n");
}
