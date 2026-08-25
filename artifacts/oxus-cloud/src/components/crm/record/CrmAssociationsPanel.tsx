import React from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Building2, Briefcase, Receipt, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import type { Client, Contact, Quote } from "@/lib/types";
import type { ProjectWithAssignees } from "@/lib/types";
import { formatRelationshipLabel } from "@/lib/crm/personRecordDisplay";

type CompanyAssoc = {
  id: string;
  company_id: string;
  relationship_type: string;
  is_primary: boolean;
  company: Client | null;
  notes?: string | null;
};

type CrmAssociationsPanelProps = {
  companies: CompanyAssoc[];
  projects: ProjectWithAssignees[];
  opportunities: Quote[];
  onSetPrimaryCompany?: (companyId: string) => void;
  canEdit?: boolean;
};

export function CrmAssociationsPanel({
  companies,
  projects,
  opportunities,
  onSetPrimaryCompany,
  canEdit,
}: CrmAssociationsPanelProps) {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Companies</h3>
        {companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No company associations yet.</p>
        ) : (
          <div className="space-y-2">
            {companies.map((cp) => (
              <div key={cp.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{cp.company?.name ?? "Unknown company"}</span>
                    {cp.is_primary && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                        <Star className="h-3 w-3" /> Primary
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatRelationshipLabel(cp.relationship_type)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {cp.company && (
                    <Button asChild variant="ghost" size="sm" className="h-8">
                      <Link href={`/companies/${cp.company.id}`}>Open</Link>
                    </Button>
                  )}
                  {canEdit && !cp.is_primary && onSetPrimaryCompany && (
                    <Button variant="outline" size="sm" className="h-8" onClick={() => onSetPrimaryCompany(cp.company_id)}>
                      Set primary
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projects</h3>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No linked projects.</p>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="block rounded-lg border p-3 hover:bg-muted/40">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{p.name}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <StatusBadge status={p.status} variant="neutral" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {opportunities.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opportunities</h3>
          <div className="space-y-2">
            {opportunities.map((q) => (
              <Link key={q.id} href={`/quotes/${q.id}`} className="block rounded-lg border p-3 hover:bg-muted/40">
                <div className="font-medium">{q.project_name ?? q.project_type ?? "Proposal"}</div>
                <div className="text-xs text-muted-foreground">{q.stage}</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

type SourceRow = {
  source_type: string;
  count: number;
  first_observed: string | null;
  last_observed: string | null;
  evidence_summary: string;
  confidence: number | null;
};

type CrmSourcesPanelProps = {
  sources: SourceRow[];
  lockedFields: string[];
  fieldProvenance: Record<string, { source: string; updated_at: string }>;
  onUnlockField?: (field: string) => void;
  isAdmin?: boolean;
};

export function CrmSourcesPanel({
  sources,
  lockedFields,
  fieldProvenance,
  onUnlockField,
  isAdmin,
}: CrmSourcesPanelProps) {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</h3>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">No source evidence recorded.</p>
        ) : (
          <div className="space-y-2">
            {sources.map((s) => (
              <div key={s.source_type} className="rounded-lg border p-3">
                <div className="font-medium">{s.source_type}</div>
                <p className="text-sm text-muted-foreground">{s.evidence_summary}</p>
                <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  {s.first_observed && (
                    <span>First observed: {format(new Date(s.first_observed), "MMM d, yyyy")}</span>
                  )}
                  {s.last_observed && (
                    <span>Last observed: {format(new Date(s.last_observed), "MMM d, yyyy")}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {lockedFields.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Manually confirmed fields</h3>
          <div className="space-y-1">
            {lockedFields.map((field) => (
              <div key={field} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div>
                  <span className="font-medium capitalize">{field.replace(/_/g, " ")}</span>
                  {fieldProvenance[field] && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {fieldProvenance[field].source} · {format(new Date(fieldProvenance[field].updated_at), "MMM d, yyyy")}
                    </span>
                  )}
                </div>
                {isAdmin && onUnlockField && (
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => onUnlockField(field)}>
                    Unlock
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
