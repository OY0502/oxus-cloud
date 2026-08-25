import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  describePineconeIndex,
  describePineconeNamespace,
  deletePineconeNamespace,
  ensurePineconeIndex,
  isPineconeConfigured,
  pineconeConfig,
  pineconeNamespace,
} from "../_shared/agent/pinecone.ts";
import {
  embedProjectKnowledgeChunks,
  processPineconeIndexJobs,
  retrieveProjectKnowledge,
  syncProjectKnowledgeToPinecone,
} from "../_shared/agent/retrieval.ts";
import { isServiceRoleRequest } from "../_shared/serviceRoleAuth.ts";
import { getAuthenticatedUser, requireSuperAdmin } from "../_shared/slack-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, status: number, code: string, details?: string) {
  return json({ error: message, code, details }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const serviceRole = await isServiceRoleRequest(req);
    const auth = serviceRole ? null : await getAuthenticatedUser(req.headers.get("Authorization"));
    if (!serviceRole && !auth) return fail("Authentication required.", 401, "AUTH_REQUIRED");

    let body: { action?: string; project_id?: string; query?: string };
    try {
      body = await req.json();
    } catch {
      return fail("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }
    const action = body.action?.trim() || "status";
    const projectId = body.project_id?.trim();
    if (!["status", "setup", "backfill", "test_query", "process_outbox", "delete_namespace"].includes(action)) {
      return fail("Unsupported action.", 400, "INVALID_INPUT");
    }
    if (!projectId && action !== "process_outbox") return fail("project_id is required.", 400, "INVALID_INPUT");

    if (!serviceRole && (action === "setup" || action === "backfill" || action === "process_outbox")) {
      const superAdmin = auth ? await requireSuperAdmin(auth.userId) : false;
      if (!superAdmin) return fail("Super-admin access required.", 403, "FORBIDDEN");
    }

    if (!serviceRole && auth && projectId) {
      const { data: project } = await auth.supabase
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .maybeSingle();
      if (!project && action !== "process_outbox") return fail("Project access required.", 403, "FORBIDDEN");
    }

    const admin = getServiceRoleSupabase();
    const config = pineconeConfig();
    if (!isPineconeConfigured()) {
      return json({
        configured: false,
        status: "not_configured",
        index_name: config.indexName,
        namespace: projectId ? pineconeNamespace(projectId) : null,
        setup_secret: "PINECONE_API_KEY",
      });
    }

    if (action === "process_outbox") {
      const result = await processPineconeIndexJobs({ admin, projectId, limit: 25 });
      return json({ configured: true, ...result });
    }

    if (!projectId) return fail("project_id is required.", 400, "INVALID_INPUT");

    if (action === "setup") {
      const index = await ensurePineconeIndex();
      return json({
        configured: true,
        status: index.status?.ready === false ? "syncing" : "ready",
        index_name: index.name,
        namespace: pineconeNamespace(projectId),
        dimension: index.dimension,
        metric: index.metric,
        index_state: index.status?.state ?? null,
      });
    }

    if (action === "backfill") {
      const embedding = await embedProjectKnowledgeChunks({
        admin,
        projectId,
        force: false,
      });
      const pinecone = await syncProjectKnowledgeToPinecone({ admin, projectId });
      return json({ configured: true, embedding, pinecone }, pinecone.error ? 502 : 200);
    }

    if (action === "delete_namespace") {
      await deletePineconeNamespace(projectId);
      return json({ configured: true, deleted: true, namespace: pineconeNamespace(projectId) });
    }

    if (action === "test_query") {
      const query = body.query?.trim();
      if (!query) return fail("query is required for test_query.", 400, "INVALID_INPUT");
      const result = await retrieveProjectKnowledge({
        admin,
        projectId,
        queryText: query,
        matchCount: 5,
        usePinecone: true,
      });
      return json({
        configured: true,
        mode: result.mode,
        pinecone_used: result.pinecone_used,
        pinecone_matches: result.pinecone_matches,
        pinecone_error: result.pinecone_error,
        matches: result.chunks.map((chunk) => ({
          id: chunk.id,
          source_id: chunk.source_id,
          source_title: chunk.metadata?.source_title ?? null,
          category: chunk.category,
          preview: chunk.content.slice(0, 240),
        })),
      });
    }

    const [index, namespaceStats, syncRow] = await Promise.all([
      describePineconeIndex(),
      describePineconeNamespace(projectId),
      admin.from("project_chat_vector_sync").select("*").eq("project_id", projectId).maybeSingle(),
    ]);
    return json({
      configured: true,
      index_name: index?.name ?? config.indexName,
      namespace: pineconeNamespace(projectId),
      index_ready: index?.status?.ready ?? false,
      index_state: index?.status?.state ?? "missing",
      vector_count: namespaceStats.vectorCount,
      sync: syncRow.data ?? null,
    });
  } catch (error) {
    console.error("[pinecone-chat-memory]", (error as Error).message);
    return fail("Pinecone chat memory request failed.", 500, "PINECONE_ERROR", (error as Error).message);
  }
});
