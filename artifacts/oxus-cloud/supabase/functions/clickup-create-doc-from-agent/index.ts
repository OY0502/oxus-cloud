import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";

import { executeCreateClickupDocFromToolRun } from "../_shared/agent/executeTools.ts";

import { mergeAndValidateClickupDocPayload } from "../_shared/agent/clickupDocTool.ts";

import {
  assertInternalOxusUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { isServiceRoleRequest } from "../_shared/serviceRoleAuth.ts";

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



function err(message: string, status: number, code: string, details?: string) {

  return json({ error: message, details, code }, status);

}



Deno.serve(async (req) => {

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");



  try {

    let body: {

      project_id?: string;

      user_id?: string;

      tool_run_id?: string;

      title?: string;

      markdown_content?: string;

      content?: string;

      input_payload_overrides?: Record<string, unknown>;

    } = {};

    try {

      body = await req.json();

    } catch {

      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");

    }



    const projectId = body.project_id?.trim();

    if (!projectId) return err("project_id is required.", 400, "INVALID_INPUT");



    const admin = getServiceRoleSupabase();

    let userId = body.user_id?.trim();



    if (!(await isServiceRoleRequest(req))) {
      let auth;
      try {
        auth = await assertInternalOxusUser(req);
      } catch (e) {
        if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
        throw e;
      }
      userId = auth.userId;

    } else if (!userId) {

      return err("user_id is required for service-role invocations.", 400, "INVALID_INPUT");

    }



    let payload: Record<string, unknown> = {

      title: body.title,

      markdown_content: body.markdown_content ?? body.content,

    };



    if (body.tool_run_id) {

      const { data: toolRun } = await admin

        .from("agent_tool_runs")

        .select("input_payload, user_id")

        .eq("id", body.tool_run_id)

        .single();

      payload = mergeAndValidateClickupDocPayload(

        (toolRun?.input_payload ?? {}) as Record<string, unknown>,

        body.input_payload_overrides,

      );

      if (!userId && toolRun?.user_id) userId = toolRun.user_id;

    }



    const result = await executeCreateClickupDocFromToolRun({

      admin,

      projectId,

      userId: userId!,

      payload,

    });



    if (body.tool_run_id) {

      await admin

        .from("agent_tool_runs")

        .update({

          status: "succeeded",

          result_payload: result,

          completed_at: new Date().toISOString(),

        })

        .eq("id", body.tool_run_id);

    }



    return json(result);

  } catch (e) {

    return err("ClickUp doc creation failed.", 500, "CLICKUP_DOC_ERROR", (e as Error).message);

  }

});


