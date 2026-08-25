export type ConfidenceBand = "high" | "medium" | "low";

export type DataQualityStatus = "accepted" | "needs_review" | "suppressed" | "ignored";

export function confidenceToBand(score: number): ConfidenceBand {
  if (score >= 0.85) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

export function bandToQualityStatus(band: ConfidenceBand, shouldSuppress = false): DataQualityStatus {
  if (shouldSuppress || band === "low") return "suppressed";
  if (band === "medium") return "needs_review";
  return "accepted";
}

export function shouldAutoCreateInCrm(confidence: number, autoCreateEnabled = true): boolean {
  return autoCreateEnabled && confidence >= 0.85;
}

export function shouldRouteToImportCenter(confidence: number, uncertainToReview = true): boolean {
  return uncertainToReview && confidence >= 0.55 && confidence < 0.85;
}

export type PrimaryContactCandidate = {
  personId: string;
  score: number;
  reasons: string[];
};

export function scorePrimaryContact(candidate: {
  personId: string;
  manuallySelected?: boolean;
  isRoleInbox?: boolean;
  isAutomated?: boolean;
  nameConfidence?: number;
  hasReliableName?: boolean;
  twoWayCount?: number;
  meetingCount?: number;
  isDecisionMaker?: boolean;
  isBillingContact?: boolean;
  isProjectContact?: boolean;
  isProposalContact?: boolean;
  isInvoiceContact?: boolean;
  recentInteractionAt?: string | null;
}): PrimaryContactCandidate {
  const reasons: string[] = [];
  let score = 0;

  if (candidate.manuallySelected) { score += 100; reasons.push("manual"); }
  if (candidate.isProjectContact) { score += 40; reasons.push("project_contact"); }
  if (candidate.isProposalContact) { score += 35; reasons.push("proposal_contact"); }
  if (candidate.isInvoiceContact) { score += 35; reasons.push("invoice_contact"); }
  if (candidate.isDecisionMaker) { score += 25; reasons.push("decision_maker"); }
  if (candidate.isBillingContact) { score += 15; reasons.push("billing_contact"); }
  if ((candidate.twoWayCount ?? 0) >= 2) { score += 20; reasons.push("two_way"); }
  if ((candidate.meetingCount ?? 0) >= 1) { score += 15; reasons.push("meetings"); }
  if (candidate.hasReliableName) { score += 10; reasons.push("reliable_name"); }
  if (candidate.nameConfidence && candidate.nameConfidence >= 0.8) { score += 5; }
  if (candidate.recentInteractionAt) { score += 5; reasons.push("recent"); }

  if (candidate.isRoleInbox) { score -= 50; reasons.push("role_inbox_penalty"); }
  if (candidate.isAutomated) { score -= 80; reasons.push("automated_penalty"); }
  if (!candidate.hasReliableName) { score -= 20; reasons.push("weak_name_penalty"); }

  return { personId: candidate.personId, score, reasons };
}

export function pickPrimaryContact(candidates: PrimaryContactCandidate[]): PrimaryContactCandidate | null {
  const viable = candidates.filter((c) => c.score >= 15);
  if (viable.length === 0) return null;
  viable.sort((a, b) => b.score - a.score);
  return viable[0];
}
