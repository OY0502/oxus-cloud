/**

 * Canonical CRM review definitions shared by KPI + Import Center UI.

 */

import { classifyEmailSender } from "./senderClassification";



export type CrmReviewKind =

  | "new_suggestion"

  | "existing_needs_review"

  | "possible_duplicate"

  | "identity_conflict"

  | "missing_classification";



export type CrmReviewCandidateType =

  | "person_candidate"

  | "company_candidate"

  | "role_inbox"

  | "automated_sender"

  | "possible_duplicate"

  | "identity_conflict"

  | "uncertain_company"

  | "lead_candidate";



export type CrmReviewAction =

  | "add_as_person"

  | "link_company_inbox"

  | "suppress"

  | "ignore";



export type CrmReviewCounts = {

  people: number;

  companies: number;

  leads: number;

  total: number;

};



export type CrmReviewItemLike = {

  entity_type: "company" | "person" | "lead" | string;

  review_identity?: string | null;

  review_kind?: CrmReviewKind | string | null;

  review_reason?: string | null;

  reason?: string | null;

  email?: string | null;

  matched_person_id?: string | null;

  matched_company_id?: string | null;

  candidate_type?: string | null;

  is_role_inbox?: boolean | null;

  id: string;

};



export function countCrmReviewItems(items: CrmReviewItemLike[]): CrmReviewCounts {

  const people = items.filter((i) => i.entity_type === "person").length;

  const companies = items.filter((i) => i.entity_type === "company").length;

  const leads = items.filter((i) => i.entity_type === "lead").length;

  return { people, companies, leads, total: people + companies + leads };

}


export function reviewIdentityFor(item: CrmReviewItemLike): string {

  if (item.review_identity) return item.review_identity;

  if (item.matched_person_id && item.entity_type === "person") return `person:${item.matched_person_id}`;

  if (item.matched_company_id && item.entity_type === "company") return `company:${item.matched_company_id}`;

  return `candidate:${item.id}`;

}



export function reviewKindLabel(kind: string | null | undefined): string {

  switch (kind) {

    case "new_suggestion":

      return "New suggestion";

    case "existing_needs_review":

      return "Needs review";

    case "possible_duplicate":

      return "Possible duplicate";

    case "identity_conflict":

      return "Identity conflict";

    case "missing_classification":

      return "Missing classification";

    default:

      return "Needs review";

  }

}



export function classifyReviewCandidateType(item: CrmReviewItemLike): CrmReviewCandidateType {

  if (item.candidate_type) return item.candidate_type as CrmReviewCandidateType;

  if (item.review_kind === "possible_duplicate") return "possible_duplicate";

  if (item.review_kind === "identity_conflict") return "identity_conflict";

  if (item.entity_type === "company") {

    if (item.review_kind === "missing_classification") return "uncertain_company";

    return "company_candidate";

  }

  if (item.entity_type === "lead") return "lead_candidate";



  const reason = `${item.reason ?? ""} ${item.review_reason ?? ""}`.toLowerCase();

  if (item.is_role_inbox || reason.includes("role inbox")) return "role_inbox";



  if (item.email) {

    const classified = classifyEmailSender(item.email);

    if (classified.category === "automated_sender" || classified.category === "infrastructure") {

      return "automated_sender";

    }

    if (classified.isRoleInbox || classified.category === "role_inbox") return "role_inbox";

  }



  if (reason.includes("automated") || reason.includes("no-reply") || reason.includes("noreply")) {

    return "automated_sender";

  }



  return "person_candidate";

}



export function candidateTypeLabel(type: CrmReviewCandidateType | string): string {

  switch (type) {

    case "person_candidate":

      return "Person";

    case "company_candidate":

      return "Company";

    case "role_inbox":

      return "Role inbox";

    case "automated_sender":

      return "Automated sender";

    case "possible_duplicate":

      return "Possible duplicate";

    case "identity_conflict":

      return "Identity conflict";

    case "uncertain_company":

      return "Uncertain company";

    case "lead_candidate":

      return "Lead";

    default:

      return "Needs review";

  }

}



export type ReviewPrimaryAction = {

  action: CrmReviewAction;

  label: string;

  variant?: "default" | "outline" | "secondary";

};



/** Context-appropriate primary + secondary actions for a review row. */

export function reviewActionsFor(item: CrmReviewItemLike): {

  primary: ReviewPrimaryAction;

  secondary: ReviewPrimaryAction[];

} {

  const type = classifyReviewCandidateType(item);



  if (type === "role_inbox") {

    return {

      primary: { action: "link_company_inbox", label: "Keep as company inbox" },

      secondary: [

        { action: "suppress", label: "Suppress", variant: "outline" },

        { action: "ignore", label: "Ignore", variant: "outline" },

      ],

    };

  }



  if (type === "automated_sender") {

    return {

      primary: { action: "suppress", label: "Suppress sender" },

      secondary: [

        { action: "ignore", label: "Ignore", variant: "outline" },

      ],

    };

  }



  if (item.entity_type === "company") {

    return {

      primary: { action: "add_as_person", label: "Add company" },

      secondary: [

        { action: "ignore", label: "Ignore", variant: "outline" },

      ],

    };

  }



  if (item.entity_type === "lead") {

    return {

      primary: { action: "add_as_person", label: "Add lead" },

      secondary: [

        { action: "ignore", label: "Ignore", variant: "outline" },

      ],

    };

  }



  return {

    primary: { action: "add_as_person", label: "Add contact" },

    secondary: [

      { action: "ignore", label: "Ignore", variant: "outline" },

    ],

  };

}



/** Client-side fallback when the review workspace API is unavailable. */

export function entityNeedsReview(entity: {

  visibility_state?: string | null;

  data_quality_status?: string | null;

  needs_review?: boolean | null;

}): boolean {

  const vis = entity.visibility_state ?? "active";

  if (vis === "suppressed" || vis === "merged" || vis === "inactive") return false;

  return (

    vis === "needs_review"

    || entity.data_quality_status === "needs_review"

    || entity.needs_review === true

  );
}
