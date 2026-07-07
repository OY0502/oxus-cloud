import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Field, TextField, TextareaField, SelectField } from "@/components/forms/FormKit";
import { SearchableSelect } from "@/components/forms/SearchableSelect";
import { CurrencyInput, TagInput } from "@/components/forms/Inputs";
import { useToast } from "@/hooks/use-toast";
import { useCreateQuote, useClients, useQuotes } from "@/hooks/api";
import {
  useContactOptions,
  useOrganizationOptions,
  useTechnologyOptions,
  useUserOptions,
} from "@/components/forms/refOptions";
import { PROJECT_TYPES } from "@/lib/types";
import { isLikelyWebsiteUrl } from "@/lib/companyWebsite";

// Next quote number: QT-{year}-{N}, where N is the highest existing sequence + 1.
function nextQuoteNumber(numbers: (string | null)[]): string {
  const year = new Date().getFullYear();
  let max = 0;
  for (const n of numbers) {
    const m = n?.match(/QT-\d{4}-(\d+)/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `QT-${year}-${String(max + 1).padStart(3, "0")}`;
}

function goBack(fallback: string, navigate: (to: string) => void) {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}

export function QuoteForm() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const create = useCreateQuote();

  const { data: clients = [] } = useClients();
  const { data: quotes = [] } = useQuotes();
  const orgOptions = useOrganizationOptions();
  const contactOptions = useContactOptions();
  const techOptions = useTechnologyOptions();
  const userOptions = useUserOptions();

  const [number, setNumber] = useState("");
  const [numberTouched, setNumberTouched] = useState(false);
  const [organizationId, setOrganizationId] = useState("");
  const [pointOfContactId, setPointOfContactId] = useState("");
  const [technologyId, setTechnologyId] = useState("");
  const [projectType, setProjectType] = useState<string>("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [budget, setBudget] = useState<number | null>(null);
  const [stage, setStage] = useState<"new-lead" | "scoping" | "proposal" | "won" | "archived">("new-lead");
  const [urgency, setUrgency] = useState<"low" | "normal" | "high">("normal");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [companyWebsiteUrl, setCompanyWebsiteUrl] = useState("");
  const [requestMessage, setRequestMessage] = useState("");

  const websiteInvalid = companyWebsiteUrl.trim() !== "" && !isLikelyWebsiteUrl(companyWebsiteUrl);

  // Auto-populate the quote number once quotes have loaded (unless edited).
  useEffect(() => {
    if (!numberTouched) setNumber(nextQuoteNumber(quotes.map((q) => q.number)));
  }, [quotes, numberTouched]);

  const orgName = useMemo(() => clients.find((c) => c.id === organizationId)?.name ?? "", [clients, organizationId]);

  const canSubmit =
    number.trim() !== "" && !!pointOfContactId && !!projectType && !!stage && !!urgency && !websiteInvalid;

  const submit = async () => {
    try {
      await create.mutateAsync({
        number: number || null,
        company: orgName || "Untitled",
        organization_id: organizationId || null,
        point_of_contact_id: pointOfContactId || null,
        technology_id: technologyId || null,
        project_type: projectType || null,
        project_name: projectName || null,
        project_description: projectDescription || null,
        budget: budget ?? 0,
        stage,
        urgency,
        assigned_user_id: assignedUserId || null,
        tags,
        company_website_url: companyWebsiteUrl.trim() || null,
        request_message: requestMessage.trim() || null,
      });
      toast({ title: "Quote created", description: number });
      goBack("/pipeline", navigate);
    } catch (e) {
      toast({ title: "Couldn't create quote", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="New Quote"
        subtitle="Capture a new opportunity in the pipeline."
        actions={
          <Button variant="outline" className="gap-2" onClick={() => goBack("/pipeline", navigate)}>
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
        }
      />

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Quote number" required>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={number}
                placeholder="QT-2026-001"
                onChange={(e) => {
                  setNumberTouched(true);
                  setNumber(e.target.value);
                }}
              />
            </Field>
            <Field label="Budget">
              <CurrencyInput value={budget} onChange={setBudget} placeholder="15,000.00" />
            </Field>
          </div>

          <Field label="Company (organization)">
            <SearchableSelect
              value={organizationId}
              onChange={setOrganizationId}
              options={orgOptions}
              placeholder="Select an organization"
              searchPlaceholder="Search organizations…"
              emptyText="No organizations found."
              footerLabel="Add new organization"
              onFooterClick={() => navigate("/contacts?tab=organizations&new=1")}
            />
          </Field>

          <Field label="Point of Contact" required>
            <SearchableSelect
              value={pointOfContactId}
              onChange={setPointOfContactId}
              options={contactOptions}
              placeholder="Select a person"
              searchPlaceholder="Search people…"
              emptyText="No people found."
              footerLabel="Add new person"
              onFooterClick={() => navigate("/contacts?tab=people&new=1")}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Technology">
              <SearchableSelect
                value={technologyId}
                onChange={setTechnologyId}
                options={techOptions}
                placeholder="Select a technology"
                searchPlaceholder="Search technologies…"
                emptyText="No technologies found."
                footerLabel="Manage technologies"
                onFooterClick={() => navigate("/technologies")}
              />
            </Field>
            <SelectField
              label="Project type"
              value={projectType}
              onChange={setProjectType}
              required
              options={[{ value: "", label: "— Select —" }, ...PROJECT_TYPES.map((t) => ({ value: t, label: t }))]}
            />
          </div>

          <TextField label="Project name" value={projectName} onChange={setProjectName} placeholder="Acme marketing site" />
          <TextareaField
            label="Project description"
            value={projectDescription}
            onChange={setProjectDescription}
            placeholder="Short summary of the work and goals…"
          />

          <div className="space-y-1">
            <TextField
              label="Company website"
              value={companyWebsiteUrl}
              onChange={setCompanyWebsiteUrl}
              type="url"
              placeholder="https://acme.com"
            />
            <p className="text-xs text-muted-foreground">
              Used to auto-enrich the client's company details when a project is created. We only read this exact site.
            </p>
            {websiteInvalid && (
              <p className="text-xs text-soft-red">Enter a valid URL, e.g. https://acme.com.</p>
            )}
          </div>

          <div className="space-y-1">
            <TextareaField
              label="Request message"
              value={requestMessage}
              onChange={setRequestMessage}
              placeholder="Paste the client's original request, lead message, or initial ask here…"
            />
            <p className="text-xs text-muted-foreground">
              The client's original ask. This is the primary signal for the initial Project Intelligence scope.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label="Stage"
              value={stage}
              onChange={setStage}
              required
              options={[
                { value: "new-lead", label: "New Lead" },
                { value: "scoping", label: "Scoping" },
                { value: "proposal", label: "Proposal" },
                { value: "won", label: "Won" },
                { value: "archived", label: "Archived" },
              ]}
            />
            <SelectField
              label="Urgency"
              value={urgency}
              onChange={setUrgency}
              required
              options={[
                { value: "low", label: "Low" },
                { value: "normal", label: "Normal" },
                { value: "high", label: "High" },
              ]}
            />
          </div>

          <Field label="Assigned to">
            <SearchableSelect
              value={assignedUserId}
              onChange={setAssignedUserId}
              options={userOptions}
              placeholder="Unassigned"
              searchPlaceholder="Search team…"
              emptyText="No users found."
            />
          </Field>

          <Field label="Tags">
            <TagInput value={tags} onChange={setTags} placeholder="Type and press comma…" />
          </Field>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => goBack("/pipeline", navigate)}>Cancel</Button>
            <Button onClick={submit} disabled={!canSubmit || create.isPending}>
              {create.isPending ? "Saving…" : "Create Quote"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
