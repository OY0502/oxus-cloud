type BillingProject = {
  id: string;
  organization_id?: string | null;
  client_id?: string | null;
};

export function projectBillingCompany(project: BillingProject): string | null {
  return project.organization_id || project.client_id || null;
}

export function isInvoiceBillingCompany(client: { id: string; company_type?: string | null }, projects: BillingProject[]): boolean {
  return (client.company_type ?? "client") === "client"
    || projects.some((project) => projectBillingCompany(project) === client.id);
}

export function invoiceSelectionForProject(project: BillingProject, companyId: string) {
  return { projectId: project.id, companyId: projectBillingCompany(project) ?? companyId };
}

export function invoiceProjectForCompany(project: BillingProject | undefined, companyId: string): string {
  if (!project) return "";
  const linkedCompany = projectBillingCompany(project);
  return !linkedCompany || linkedCompany === companyId ? project.id : "";
}
