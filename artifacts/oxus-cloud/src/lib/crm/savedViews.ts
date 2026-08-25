export type CrmTab = "people" | "companies" | "leads" | "import";



export type CrmSavedView = {

  id: string;

  label: string;

  tab: CrmTab;

  filters: Record<string, string | boolean | string[]>;

  isDefault?: boolean;

};



/**

 * HubSpot-style compact saved views for People.

 * Relationship / source / activity filters live in the toolbar, not as permanent tabs.

 */

export const PEOPLE_SAVED_VIEWS: CrmSavedView[] = [

  { id: "all", label: "All contacts", tab: "people", filters: { active_only: true }, isDefault: true },

  { id: "my_contacts", label: "My contacts", tab: "people", filters: { active_only: true, owner: "me" } },

  { id: "unassigned", label: "Unassigned contacts", tab: "people", filters: { active_only: true, unassigned_owner: true } },

  { id: "recently_active", label: "Recently active", tab: "people", filters: { active_only: true, recently_active: "30d" } },

  { id: "meeting_contacts", label: "Meeting contacts", tab: "people", filters: { active_only: true, has_meetings: true } },

  { id: "needs_review", label: "Needs review", tab: "people", filters: { quality: "needs_review", include_review: true } },

  { id: "inactive", label: "Inactive", tab: "people", filters: { status: "inactive" } },

];



export const COMPANY_SAVED_VIEWS: CrmSavedView[] = [

  { id: "all", label: "All companies", tab: "companies", filters: { active_only: true }, isDefault: true },

  { id: "clients", label: "Clients", tab: "companies", filters: { active_only: true, company_type: "client" } },

  { id: "prospects", label: "Prospects", tab: "companies", filters: { active_only: true, company_type: "prospect" } },

  { id: "partners", label: "Partners", tab: "companies", filters: { active_only: true, company_type: "partner" } },

  { id: "vendors", label: "Vendors", tab: "companies", filters: { active_only: true, company_type: "vendor" } },

  { id: "tools", label: "Tools and platforms", tab: "companies", filters: { active_only: true, company_type: "tool" } },

  { id: "recently_active", label: "Recently active", tab: "companies", filters: { active_only: true, recently_active: "30d" } },

  { id: "needs_review", label: "Needs review", tab: "companies", filters: { quality: "needs_review", include_review: true } },

  { id: "inactive", label: "Inactive", tab: "companies", filters: { company_type: "inactive" } },

];



/** Primary views shown as compact tabs; the rest stay available via overflow / filters. */

export const PEOPLE_PRIMARY_VIEW_IDS = ["all", "my_contacts", "unassigned"] as const;



const CRM_TAB_KEY = "oxus-crm-last-tab";



export function loadLastCrmTab(): CrmTab {

  try {

    const raw = localStorage.getItem(CRM_TAB_KEY);

    if (raw === "people" || raw === "companies" || raw === "leads" || raw === "import") return raw;

  } catch { /* ignore */ }

  return "people";

}

export function saveLastCrmTab(tab: CrmTab): void {

  try {

    localStorage.setItem(CRM_TAB_KEY, tab);

  } catch { /* ignore */ }

}



export function getSavedViewsForTab(tab: CrmTab): CrmSavedView[] {

  if (tab === "people") return PEOPLE_SAVED_VIEWS;

  if (tab === "companies") return COMPANY_SAVED_VIEWS;

  return [];
}


export function getPrimarySavedViewsForTab(tab: CrmTab): CrmSavedView[] {

  if (tab === "people") {

    return PEOPLE_SAVED_VIEWS.filter((v) =>

      (PEOPLE_PRIMARY_VIEW_IDS as readonly string[]).includes(v.id)

      || v.id === "needs_review"

    );

  }

  if (tab === "companies") {

    return COMPANY_SAVED_VIEWS.filter((v) =>

      ["all", "clients", "prospects", "needs_review"].includes(v.id)

    );

  }

  return [];

}
