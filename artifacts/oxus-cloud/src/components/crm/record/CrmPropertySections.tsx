import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Client, Contact, Profile, ProjectWithAssignees } from "@/lib/types";
import { formatLifecycleLabel, formatRelationshipLabel } from "@/lib/crm/personRecordDisplay";
import { format } from "date-fns";

type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "email" | "textarea" | "select";
  options?: { value: string; label: string }[];
  readOnly?: boolean;
  value: string;
};

function buildFields(
  person: Contact,
  editing: boolean,
  draft: Record<string, string>,
  owner?: Profile | null,
  primaryCompany?: Client | null,
): { key: string; label: string; fields: FieldDef[] }[] {
  const val = (key: string, fallback = ""): string => {
    if (editing && key in draft) return draft[key];
    const raw = (person as unknown as Record<string, unknown>)[key];
    if (Array.isArray(raw)) return raw.join(", ");
    if (raw == null) return fallback;
    return String(raw);
  };

  return [
    {
      key: "key",
      label: "Key information",
      fields: [
        { key: "first_name", label: "First name", value: val("first_name") },
        { key: "last_name", label: "Last name", value: val("last_name") },
        { key: "display_name", label: "Display name", value: val("display_name", person.name) },
        { key: "email", label: "Email", type: "email", value: val("email", person.primary_email ?? "") },
        { key: "alternate_emails", label: "Alternate emails", value: val("alternate_emails") },
        { key: "phone", label: "Phone", value: val("phone") },
        { key: "job_title", label: "Job title", value: val("job_title") },
        { key: "location", label: "Location", value: val("location") },
        { key: "language", label: "Language", value: val("language") },
        { key: "timezone", label: "Timezone", value: val("timezone") },
        {
          key: "relationship_owner_id",
          label: "Owner",
          readOnly: !editing,
          value: owner?.full_name ?? "—",
        },
      ],
    },
    {
      key: "relationship",
      label: "Relationship",
      fields: [
        {
          key: "relationship_type",
          label: "Relationship type",
          type: "select",
          options: [
            "client_contact", "decision_maker", "billing_contact", "technical_contact",
            "lead", "partner", "vendor_contact", "employee", "contractor", "other",
          ].map((v) => ({ value: v, label: formatRelationshipLabel(v) })),
          value: val("relationship_type"),
        },
        {
          key: "lifecycle_stage",
          label: "Lifecycle stage",
          type: "select",
          options: [
            "subscriber", "lead", "marketing_qualified", "sales_qualified",
            "opportunity", "customer", "evangelist", "other",
          ].map((v) => ({ value: v, label: formatLifecycleLabel(v) })),
          value: val("lifecycle_stage"),
        },
        {
          key: "client_id",
          label: "Primary company",
          readOnly: true,
          value: primaryCompany?.name ?? person.company ?? "—",
        },
        {
          key: "first_interaction_at",
          label: "First interaction",
          readOnly: true,
          value: person.first_interaction_at
            ? format(new Date(person.first_interaction_at), "MMM d, yyyy")
            : "—",
        },
        {
          key: "last_interaction_at",
          label: "Last interaction",
          readOnly: true,
          value: person.last_interaction_at
            ? format(new Date(person.last_interaction_at), "MMM d, yyyy")
            : "—",
        },
        {
          key: "next_meeting_at",
          label: "Next meeting",
          readOnly: true,
          value: person.next_meeting_at
            ? format(new Date(person.next_meeting_at), "MMM d, yyyy")
            : "—",
        },
      ],
    },
    {
      key: "context",
      label: "Internal context",
      fields: [
        { key: "notes", label: "Internal notes", type: "textarea", value: val("notes") },
        { key: "tags", label: "Tags", value: val("tags") },
      ],
    },
  ];
}

type CrmPropertySectionsProps = {
  person: Contact;
  owner?: Profile | null;
  primaryCompany?: Client | null;
  primaryProject?: ProjectWithAssignees | null;
  editing: boolean;
  draft: Record<string, string>;
  onDraftChange: (key: string, value: string) => void;
  showDataQuality?: boolean;
};

export function CrmPropertySections({
  person,
  owner,
  primaryCompany,
  primaryProject,
  editing,
  draft,
  onDraftChange,
  showDataQuality,
}: CrmPropertySectionsProps) {
  const sections = buildFields(person, editing, draft, owner, primaryCompany);

  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <section key={section.key} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {section.label}
          </h3>
          <div className="divide-y divide-border/50 rounded-lg border border-border/60 bg-card/30">
            {section.fields.map((field) => (
              <div key={field.key} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[140px_1fr] sm:items-start">
                <Label className="text-xs text-muted-foreground pt-1">{field.label}</Label>
                {editing && !field.readOnly ? (
                  field.type === "textarea" ? (
                    <Textarea
                      className="min-h-[72px] text-sm"
                      value={field.value}
                      onChange={(e) => onDraftChange(field.key, e.target.value)}
                    />
                  ) : field.type === "select" && field.options ? (
                    <Select value={field.value || undefined} onValueChange={(v) => onDraftChange(field.key, v)}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="h-9 text-sm"
                      type={field.type ?? "text"}
                      value={field.value}
                      onChange={(e) => onDraftChange(field.key, e.target.value)}
                    />
                  )
                ) : (
                  <div className="text-sm text-foreground break-words">
                    {field.key === "client_id"
                      ? (primaryCompany?.name ?? person.company ?? "—")
                      : field.key === "primary_project_id"
                        ? (primaryProject?.name ?? "—")
                        : (field.value || "—")}
                  </div>
                )}
              </div>
            ))}
            {section.key === "relationship" && primaryProject && (
              <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[140px_1fr]">
                <Label className="text-xs text-muted-foreground">Primary project</Label>
                <div className="text-sm">{primaryProject.name}</div>
              </div>
            )}
          </div>
        </section>
      ))}

      {showDataQuality && !person.manually_confirmed && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data quality</h3>
          <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 p-3 text-sm space-y-1">
            {person.name_confidence != null && (
              <p>Name confidence: {Math.round(person.name_confidence * 100)}%</p>
            )}
            {person.identity_confidence != null && (
              <p>Identity confidence: {Math.round(Number(person.identity_confidence) * 100)}%</p>
            )}
            {person.data_quality_status === "needs_review" && (
              <p className="text-amber-800">Recommended: confirm name and primary company association.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export function draftFromPerson(person: Contact): Record<string, string> {
  return {
    first_name: person.first_name ?? "",
    last_name: person.last_name ?? "",
    display_name: person.display_name ?? person.name ?? "",
    email: person.email ?? person.primary_email ?? "",
    alternate_emails: (person.alternate_emails ?? []).join(", "),
    phone: person.phone ?? "",
    job_title: person.job_title ?? "",
    location: person.location ?? "",
    language: person.language ?? "",
    timezone: person.timezone ?? "",
    relationship_type: person.relationship_type ?? "",
    lifecycle_stage: person.lifecycle_stage ?? "",
    notes: person.notes ?? "",
    tags: (person.tags ?? []).join(", "),
  };
}

export function draftToUpdatePayload(draft: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...draft };
  if (draft.alternate_emails) {
    payload.alternate_emails = draft.alternate_emails
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (draft.tags) {
    payload.tags = draft.tags.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return payload;
}
