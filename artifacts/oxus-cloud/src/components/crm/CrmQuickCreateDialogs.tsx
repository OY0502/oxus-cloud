import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { FormDialog, TextField, NumberField, SelectField, Field } from "@/components/forms/FormKit";
import { EmailInput } from "@/components/forms/Inputs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  useClients,
  useContacts,
  useCreateClient,
  useCreateContact,
  useCreateQuote,
  useCrmImportCandidates,
} from "@/hooks/api";
import { parseDomainInput } from "@/lib/crm/domain";
import { classifyEmailSender } from "@/lib/crm/senderClassification";
import { resolvePersonName } from "@/lib/crm/personNaming";
import { resolveCompanyName } from "@/lib/crm/companyNaming";
export type CrmQuickCreateKind = "company" | "person" | "lead";

type Props = {
  kind: CrmQuickCreateKind | null;
  onKindChange: (kind: CrmQuickCreateKind | null) => void;
};

const FREE_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com"]);

function normalizeDomain(input: string): string {
  return parseDomainInput(input).registrableDomain ?? parseDomainInput(input).normalizedHost;
}

export function CrmQuickCreateDialogs({ kind, onKindChange }: Props) {
  const open = kind !== null;
  const close = () => onKindChange(null);

  if (kind === "company") return <CompanyQuickCreate open={open} onOpenChange={(o) => !o && close()} />;
  if (kind === "person") return <PersonQuickCreate open={open} onOpenChange={(o) => !o && close()} />;
  if (kind === "lead") return <LeadQuickCreate open={open} onOpenChange={(o) => !o && close()} />;
  return null;
}

function CompanyQuickCreate({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const create = useCreateClient();
  const { data: clients = [] } = useClients();
  const candidatesQuery = useCrmImportCandidates();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [companyType, setCompanyType] = useState("client");
  const [primaryContact, setPrimaryContact] = useState("");

  const domain = useMemo(() => normalizeDomain(website), [website]);
  const suggestedName = useMemo(() => {
    if (!domain) return "";
    return resolveCompanyName({ domain }).displayName;
  }, [domain]);

  useEffect(() => {
    if (!name.trim() && suggestedName) setName(suggestedName);
  }, [suggestedName, name]);
  const duplicateWarnings = useMemo(() => {
    const warnings: string[] = [];
    const q = name.trim().toLowerCase();
    if (q && clients.some((c) => c.name.toLowerCase() === q)) warnings.push("A company with this name already exists.");
    if (domain && clients.some((c) => normalizeDomain(c.website ?? "") === domain)) warnings.push("A company with this domain already exists.");
    const candidate = (candidatesQuery.data?.candidates ?? []).find(
      (c) => c.entity_type === "company" && (c.domain === domain || c.display_name.toLowerCase() === q),
    );
    if (candidate) warnings.push(`Google import candidate "${candidate.display_name}" may be the same organization.`);
    return warnings;
  }, [name, domain, clients, candidatesQuery.data]);

  const reset = () => { setName(""); setWebsite(""); setCompanyType("client"); setPrimaryContact(""); };

  const submit = async () => {
    try {
      await create.mutateAsync({
        name: name.trim(),
        website: website.trim() || null,
        company_type: companyType as "client" | "prospect" | "partner" | "vendor" | "tool" | "unknown",
        notes: primaryContact ? `Primary contact note: ${primaryContact}` : null,
      });
      toast({ title: "Company created", description: name });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't create company", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add company" onSubmit={submit} submitting={create.isPending} disabled={!name.trim()}>
      <TextField label="Website or domain" value={website} onChange={setWebsite} placeholder="acme.com" required />
      <TextField label="Company name" value={name} onChange={setName} required placeholder="Acme Inc." />
      <SelectField label="Relationship" value={companyType} onChange={setCompanyType} options={[
        { value: "client", label: "Client" },
        { value: "prospect", label: "Prospect" },
        { value: "partner", label: "Partner" },
        { value: "vendor", label: "Vendor" },
        { value: "tool", label: "Tool or platform" },
        { value: "unknown", label: "Unknown" },
      ]} />
      {duplicateWarnings.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{duplicateWarnings.join(" ")}</AlertDescription>
        </Alert>
      )}
    </FormDialog>
  );
}

function PersonQuickCreate({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const create = useCreateContact();
  const { data: clients = [] } = useClients();
  const { data: contacts = [] } = useContacts();
  const candidatesQuery = useCrmImportCandidates();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [emailValid, setEmailValid] = useState(true);
  const [clientId, setClientId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");

  const senderInfo = useMemo(() => (email ? classifyEmailSender(email) : null), [email]);
  const resolvedName = useMemo(() => {
    if (!email) return null;
    return resolvePersonName({
      email,
      displayName: [firstName, lastName].filter(Boolean).join(" ") || null,
    });
  }, [email, firstName, lastName]);

  const inferredDomain = useMemo(() => (email ? parseDomainInput(email.split("@")[1] ?? "").registrableDomain : null), [email]);
  const clientOptions = useMemo(
    () => [{ value: "", label: "— No company —" }, ...clients.map((c) => ({ value: c.id, label: c.name }))],
    [clients],
  );

  useEffect(() => {
    if (!inferredDomain || clientId) return;
    const match = clients.find((c) =>
      normalizeDomain(c.registrable_domain ?? c.website ?? "") === inferredDomain,
    );
    if (match) setClientId(match.id);
  }, [inferredDomain, clientId, clients]);

  const duplicateWarnings = useMemo(() => {
    const warnings: string[] = [];
    const normalized = email.trim().toLowerCase();
    if (normalized && contacts.some((c) => (c.email ?? "").toLowerCase() === normalized)) {
      warnings.push("A person with this email already exists in CRM.");
    }
    const candidate = (candidatesQuery.data?.candidates ?? []).find(
      (c) => c.entity_type === "person" && (c.email ?? "").toLowerCase() === normalized,
    );
    if (candidate) warnings.push(`Google import candidate "${candidate.display_name}" matches this email.`);
    if (inferredDomain && !clientId && senderInfo?.category === "corporate") {
      warnings.push(`Corporate email domain: ${inferredDomain}. Select or create a company before saving.`);
    }
    if (senderInfo?.isRoleInbox) {
      warnings.push("This looks like a role inbox — name will be saved as a general inbox contact.");
    }
    return warnings;
  }, [email, contacts, candidatesQuery.data, inferredDomain, clientId, clients, senderInfo]);

  const reset = () => { setFirstName(""); setLastName(""); setEmail(""); setEmailValid(true); setClientId(""); setJobTitle(""); setPhone(""); };

  const displayName = [firstName, lastName].filter(Boolean).join(" ") || resolvedName?.displayName || "";

  const submit = async () => {
    try {
      const companyName = clientId ? clients.find((c) => c.id === clientId)?.name ?? null : null;
      const finalName = displayName || resolvedName?.displayName || email.split("@")[0];
      await create.mutateAsync({
        name: finalName,
        type: clientId ? "client" : "lead",
        client_id: clientId || null,
        company: companyName,
        email: email.trim() || null,
        phone: phone.trim() || null,
        job_title: jobTitle.trim() || null,
        source: "Manual",
        relationship_strength: "new",
      });
      toast({ title: "Person added", description: finalName });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't add person", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add person" onSubmit={submit} submitting={create.isPending} disabled={!emailValid || !email.trim()}>
      <Field label="Email">
        <EmailInput value={email} onChange={setEmail} onValidityChange={setEmailValid} placeholder="jane@acme.com" />
      </Field>
      <TextField label="First name" value={firstName} onChange={setFirstName} placeholder={resolvedName?.isRoleInbox ? "General inbox" : "Jane"} />
      <TextField label="Last name" value={lastName} onChange={setLastName} placeholder="Doe" />
      <SelectField label="Primary company" value={clientId} onChange={setClientId} options={clientOptions} />
      <TextField label="Job title" value={jobTitle} onChange={setJobTitle} placeholder="Head of Product" />
      <TextField label="Phone (optional)" value={phone} onChange={setPhone} placeholder="+1 555 000 0000" />
      {duplicateWarnings.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{duplicateWarnings.join(" ")}</AlertDescription>
        </Alert>
      )}
    </FormDialog>
  );
}

function LeadQuickCreate({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const create = useCreateQuote();
  const { data: clients = [] } = useClients();
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [clientId, setClientId] = useState("");
  const [contactName, setContactName] = useState("");
  const [value, setValue] = useState("");
  const [source, setSource] = useState("Inbound");
  const [stage, setStage] = useState("new-lead");

  const clientOptions = useMemo(
    () => [{ value: "", label: "— Select company —" }, ...clients.map((c) => ({ value: c.id, label: c.name }))],
    [clients],
  );

  const reset = () => { setTitle(""); setCompany(""); setClientId(""); setContactName(""); setValue(""); setSource("Inbound"); setStage("new-lead"); };

  const submit = async () => {
    try {
      const companyName = company.trim() || clients.find((c) => c.id === clientId)?.name || "Unknown";
      await create.mutateAsync({
        company: companyName,
        organization_id: clientId || null,
        contact_name: contactName.trim() || null,
        project_name: title.trim(),
        budget: value ? Number(value) : 0,
        stage: stage as "new-lead" | "scoping" | "proposal",
        tags: source ? [source] : [],
      });
      toast({ title: "Lead created", description: title });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't create lead", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add lead" onSubmit={submit} submitting={create.isPending} disabled={!title.trim()}>
      <TextField label="Opportunity title" value={title} onChange={setTitle} required placeholder="Website redesign" />
      <SelectField label="Company" value={clientId} onChange={setClientId} options={clientOptions} />
      {!clientId && <TextField label="Company name" value={company} onChange={setCompany} placeholder="Acme Inc." />}
      <TextField label="Contact" value={contactName} onChange={setContactName} placeholder="Jane Doe" />
      <NumberField label="Value (€)" value={value} onChange={setValue} placeholder="25000" />
      <TextField label="Source" value={source} onChange={setSource} placeholder="Referral, Inbound…" />
      <SelectField label="Stage" value={stage} onChange={setStage} options={[
        { value: "new-lead", label: "New lead" },
        { value: "scoping", label: "Scoping" },
        { value: "proposal", label: "Proposal" },
      ]} />
    </FormDialog>
  );
}
