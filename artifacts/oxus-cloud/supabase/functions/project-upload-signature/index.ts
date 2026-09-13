import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertInternalOxusUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";

const BUCKET = "documents";
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function isValidObjectPath(projectId: string, objectPath: string): boolean {
  const prefix = `project/${projectId}/`;
  return (
    objectPath.startsWith(prefix) &&
    objectPath.length > prefix.length &&
    objectPath.length <= 1024 &&
    !objectPath.includes("..") &&
    !objectPath.includes("\\")
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    await assertInternalOxusUser(req);
    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      object_path?: string;
    };
    const projectId = body.project_id?.trim() ?? "";
    const objectPath = body.object_path?.trim() ?? "";

    if (!PROJECT_ID_PATTERN.test(projectId)) return json({ error: "A valid project_id is required." }, 400);
    if (!isValidObjectPath(projectId, objectPath)) return json({ error: "Invalid project upload path." }, 400);

    const admin = getServiceRoleSupabase();
    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!project) return json({ error: "Project not found." }, 404);

    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(objectPath, { upsert: false });
    if (error || !data?.token) throw new Error(error?.message ?? "Storage did not return an upload signature.");

    return json({ token: data.token, path: objectPath });
  } catch (error) {
    if (error instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(error, corsHeaders);
    console.error("[project-upload-signature]", (error as Error).message);
    return json({ error: "Could not authorize the recording upload." }, 500);
  }
});
