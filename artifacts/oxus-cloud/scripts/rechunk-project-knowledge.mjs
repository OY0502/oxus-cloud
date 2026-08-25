const args = process.argv.slice(2);
const projectFlag = args.indexOf("--project-id");
const projectId = projectFlag >= 0 ? args[projectFlag + 1]?.trim() : "";
const apply = args.includes("--apply");

if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(projectId)) {
  throw new Error("Pass a valid --project-id UUID.");
}

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!supabaseUrl || !serviceKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const headers = {
  Authorization: `Bearer ${serviceKey}`,
  apikey: serviceKey,
  "Content-Type": "application/json",
};

async function request(path, init = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

function chunkText(text, size = 2200, overlap = 250) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);
    if (end < normalized.length) {
      const searchFrom = start + Math.floor(size * 0.6);
      const window = normalized.slice(searchFrom, end);
      const paragraphBreak = window.lastIndexOf("\n\n");
      const lineBreak = window.lastIndexOf("\n");
      const sentenceBreak = window.lastIndexOf(". ");
      const breakAt = Math.max(
        paragraphBreak >= 0 ? paragraphBreak + 2 : -1,
        lineBreak + 1,
        sentenceBreak + 2,
      );
      if (breakAt > 0) end = searchFrom + breakAt;
    }
    const content = normalized.slice(start, end).trim();
    if (content) chunks.push(content);
    if (end >= normalized.length) break;
    start = Math.max(end - Math.min(overlap, Math.floor(size / 4)), start + 1);
  }
  return chunks;
}

function isLowValueWebsitePage(source) {
  if (source.source_type !== "company_website_page") return false;
  return /(?:privacy|terms|cookie|legal)/i.test(source.source_title ?? "");
}

function categoryFor(sourceType) {
  if (sourceType === "agent") return "agent_intake";
  return sourceType || "project_knowledge";
}

const sourceParams = new URLSearchParams({
  select: "id,project_id,source_type,source_title,source_text,sync_status",
  project_id: `eq.${projectId}`,
  sync_status: "eq.active",
  order: "created_at.asc",
});
const sources = await request(`/rest/v1/project_knowledge_sources?${sourceParams}`);

const summary = {
  mode: apply ? "apply" : "dry-run",
  project_id: projectId,
  sources_seen: sources.length,
  sources_rechunked: 0,
  chunks_inserted: 0,
  chunks_replaced: 0,
  sources_excluded: 0,
};

for (const source of sources) {
  if (isLowValueWebsitePage(source)) {
    summary.sources_excluded += 1;
    if (apply) {
      await request(`/rest/v1/project_knowledge_sources?id=eq.${source.id}&project_id=eq.${projectId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ sync_status: "out_of_scope" }),
      });
    }
    continue;
  }

  const sourceText = String(source.source_text ?? "").trim();
  if (sourceText.length <= 3200) continue;

  const existingParams = new URLSearchParams({
    select: "id",
    project_id: `eq.${projectId}`,
    source_id: `eq.${source.id}`,
  });
  const existing = await request(`/rest/v1/project_knowledge_chunks?${existingParams}`);
  const chunks = chunkText(sourceText);
  summary.sources_rechunked += 1;
  summary.chunks_inserted += chunks.length;
  summary.chunks_replaced += existing.length;

  if (!apply) continue;

  await request("/rest/v1/project_knowledge_chunks", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(chunks.map((content, index) => ({
      project_id: projectId,
      source_id: source.id,
      chunk_index: index,
      content,
      category: categoryFor(source.source_type),
      metadata: {
        char_count: content.length,
        source_title: source.source_title,
        source_type: source.source_type,
        rechunk_version: 2,
      },
    }))),
  });

  if (existing.length > 0) {
    const ids = existing.map((row) => row.id).join(",");
    await request(`/rest/v1/project_knowledge_chunks?id=in.(${ids})&project_id=eq.${projectId}&source_id=eq.${source.id}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }
}

console.log(JSON.stringify(summary));
