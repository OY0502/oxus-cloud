import crmHandler from "../_shared/crmHandler.ts";
import { listCrmReviewWorkspace } from "../_shared/crmReviewQueue.ts";

Deno.serve(crmHandler(async (admin, _userId, body) => {
  const entityType = body.entity_type ? String(body.entity_type) : undefined;
  const limit = Number(body.limit ?? 500);
  // status other than pending is legacy candidate-only listing
  const status = String(body.status ?? "pending");
  if (status !== "pending") {
    let query = admin
      .from("crm_entity_candidates")
      .select("*")
      .eq("status", status)
      .order("confidence", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 1000));
    if (entityType) query = query.eq("entity_type", entityType);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const candidates = data ?? [];
    return {
      candidates,
      counts: {
        people: candidates.filter((c) => c.entity_type === "person").length,
        companies: candidates.filter((c) => c.entity_type === "company").length,
        leads: candidates.filter((c) => c.entity_type === "lead").length,
        total: candidates.length,
      },
    };
  }

  return listCrmReviewWorkspace(admin, { entity_type: entityType, limit });
}));
