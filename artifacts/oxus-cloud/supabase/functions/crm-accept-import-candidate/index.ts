import crmHandler from "../_shared/crmHandler.ts";
import { acceptCrmReviewItem } from "../_shared/crmReviewQueue.ts";
import type { CrmReviewAction } from "../_shared/crmPersonPublication.ts";

Deno.serve(crmHandler(async (admin, userId, body) => {
  const reviewIdentity = String(body.review_identity ?? body.candidate_id ?? "");
  if (!reviewIdentity) throw new Error("review_identity or candidate_id required.");

  const rawAction = String(body.action ?? body.decision ?? "add_as_person");
  const allowed: CrmReviewAction[] = ["add_as_person", "link_company_inbox", "suppress", "ignore"];
  const action = (allowed.includes(rawAction as CrmReviewAction)
    ? rawAction
    : "add_as_person") as CrmReviewAction;

  const result = await acceptCrmReviewItem(
    admin,
    userId,
    reviewIdentity,
    body.overrides as Record<string, unknown> | undefined,
    action,
  );
  return { success: true, ...result };
}));
