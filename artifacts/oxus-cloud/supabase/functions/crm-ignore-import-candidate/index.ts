import crmHandler from "../_shared/crmHandler.ts";
import { ignoreCrmReviewItem } from "../_shared/crmReviewQueue.ts";

Deno.serve(crmHandler(async (admin, userId, body) => {
  const reviewIdentity = String(body.review_identity ?? body.candidate_id ?? "");
  if (!reviewIdentity) throw new Error("review_identity or candidate_id required.");
  await ignoreCrmReviewItem(admin, userId, reviewIdentity);
  return { success: true };
}));
