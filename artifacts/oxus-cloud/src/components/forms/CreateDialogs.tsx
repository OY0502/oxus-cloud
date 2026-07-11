import React, { useMemo, useState } from "react";
import { FormDialog, TextField, NumberField, TextareaField, SelectField, Field } from "./FormKit";
import { EmailInput, TagInput } from "./Inputs";
import { useToast } from "@/hooks/use-toast";
import {
  useClients,
  useProfiles,
  useCreateClient,
  useCreateContact,
  useCreateInvoice,
  useCreateEvent,
  useCreateTransaction,
} from "@/hooks/api";
import { profileDisplayName } from "@/lib/profiles";
import type { ContactType } from "@/lib/types";

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

function useAppUserOptions() {
  const { data: users = [] } = useProfiles();
  const options = useMemo(
    () => [
      { value: "", label: "— Unassigned —" },
      ...users.map((u) => ({ value: u.id, label: profileDisplayName(u) })),
    ],
    [users],
  );
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  return { options, byId, users };
}

function useClientOptions() {
  const { data: clients = [] } = useClients();
  const options = useMemo(
    () => [{ value: "", label: "— No client —" }, ...clients.map((c) => ({ value: c.id, label: c.name }))],
    [clients],
  );
  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  return { options, byId, clients };
}

function suggestNumber(prefix: string) {
  const year = new Date().getFullYear();
  const n = Math.floor(Math.random() * 900 + 100);
  return `${prefix}-${year}-${n}`;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
export function CreateClientDialog({ open, onOpenChange }: DialogProps) {
  const { toast } = useToast();
  const create = useCreateClient();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => { setName(""); setWebsite(""); setIndustry(""); setNotes(""); };

  const submit = async () => {
    try {
      await create.mutateAsync({ name, website: website || null, industry: industry || null, notes: notes || null });
      toast({ title: "Organization created", description: name });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't create organization", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New Organization" onSubmit={submit} submitting={create.isPending} disabled={!name.trim()}>
      <TextField label="Organization name" value={name} onChange={setName} required placeholder="Acme Inc." />
      <TextField label="Website" value={website} onChange={setWebsite} placeholder="https://acme.com" />
      <TextField label="Industry" value={industry} onChange={setIndustry} placeholder="Fintech" />
      <TextareaField label="Notes" value={notes} onChange={setNotes} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Contact — one place to add clients, contractors and agents.
//   * client     → relationship + source (CRM fields)
//   * contractor → role, rate, availability, location, tech stack (team fields)
//   * agent      → basic third-party contact (e.g. external support)
// ---------------------------------------------------------------------------
export function CreateContactDialog({
  open,
  onOpenChange,
  defaultType = "client",
}: DialogProps & { defaultType?: ContactType }) {
  const { toast } = useToast();
  const create = useCreateContact();
  const { options: clientOptions, byId } = useClientOptions();
  const [name, setName] = useState("");
  const [type, setType] = useState<ContactType>(defaultType);
  const [clientId, setClientId] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [emailValid, setEmailValid] = useState(true);
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  // client fields
  const [strength, setStrength] = useState<"strong" | "medium" | "weak" | "new">("new");
  const [source, setSource] = useState("");
  // contractor fields
  const [jobTitle, setJobTitle] = useState("");
  const [rate, setRate] = useState("");
  const [availability, setAvailability] = useState<"full" | "partial" | "busy" | "unavailable">("full");
  const [location, setLocation] = useState("");
  const [employment, setEmployment] = useState<"employee" | "contractor">("contractor");
  const [stack, setStack] = useState<string[]>([]);

  const reset = () => {
    setName(""); setType(defaultType); setClientId(""); setCompany(""); setEmail(""); setEmailValid(true);
    setPhone(""); setNotes(""); setStrength("new"); setSource("");
    setJobTitle(""); setRate(""); setAvailability("full"); setLocation(""); setEmployment("contractor"); setStack([]);
  };

  const submit = async () => {
    try {
      await create.mutateAsync({
        name,
        type,
        client_id: clientId || null,
        company: company || byId.get(clientId)?.name || null,
        email: email || null,
        phone: phone || null,
        relationship_strength: type === "client" ? strength : "new",
        source: type === "client" ? source || null : null,
        notes: notes || null,
        // contractor-only fields
        job_title: type === "contractor" ? jobTitle || null : null,
        hourly_rate: type === "contractor" && rate ? Number(rate) : null,
        availability: type === "contractor" ? availability : null,
        location: type === "contractor" ? location || null : null,
        employment_type: type === "contractor" ? employment : null,
        stack: type === "contractor" ? stack : [],
      });
      toast({ title: "Contact added", description: name });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't add contact", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add Contact" onSubmit={submit} submitting={create.isPending} disabled={!name.trim() || !emailValid}>
      <TextField label="Full name" value={name} onChange={setName} required placeholder="Jane Doe" />
      <SelectField label="Contact type" value={type} onChange={setType} required options={[
        { value: "client", label: "Client" },
        { value: "contractor", label: "Contractor" },
        { value: "agent", label: "Agent" },
      ]} />

      <SelectField label="Linked organization" value={clientId} onChange={setClientId} options={clientOptions} />
      {!clientId && <TextField label="Company" value={company} onChange={setCompany} placeholder="Company name" />}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Email">
          <EmailInput value={email} onChange={setEmail} onValidityChange={setEmailValid} placeholder="jane@acme.com" />
        </Field>
        <TextField label="Phone" value={phone} onChange={setPhone} placeholder="+1 555 000 0000" />
      </div>

      {type === "client" && (
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Relationship" value={strength} onChange={setStrength} options={[
            { value: "new", label: "New" }, { value: "weak", label: "Weak" }, { value: "medium", label: "Medium" }, { value: "strong", label: "Strong" },
          ]} />
          <TextField label="Source" value={source} onChange={setSource} placeholder="Referral, Inbound…" />
        </div>
      )}

      {type === "contractor" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Role / title" value={jobTitle} onChange={setJobTitle} placeholder="Frontend Engineer" />
            <TextField label="Location" value={location} onChange={setLocation} placeholder="Berlin, Germany" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Engagement" value={employment} onChange={setEmployment} options={[
              { value: "contractor", label: "Contractor" }, { value: "employee", label: "Employee" },
            ]} />
            <SelectField label="Availability" value={availability} onChange={setAvailability} options={[
              { value: "full", label: "Full" }, { value: "partial", label: "Partial" }, { value: "busy", label: "Busy" }, { value: "unavailable", label: "Unavailable" },
            ]} />
          </div>
          <NumberField label="Hourly rate (€)" value={rate} onChange={setRate} placeholder="80" />
          <Field label="Tech stack">
            <TagInput value={stack} onChange={setStack} placeholder="React, TypeScript…" />
          </Field>
        </>
      )}

      <TextareaField label="Notes" value={notes} onChange={setNotes} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------
export function CreateInvoiceDialog({ open, onOpenChange }: DialogProps) {
  const { toast } = useToast();
  const create = useCreateInvoice();
  const { options: clientOptions, byId } = useClientOptions();
  const [number, setNumber] = useState(() => suggestNumber("INV"));
  const [clientId, setClientId] = useState("");
  const [project, setProject] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"draft" | "sent" | "viewed" | "partial" | "overdue" | "paid">("draft");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");

  const reset = () => { setNumber(suggestNumber("INV")); setClientId(""); setProject(""); setAmount(""); setStatus("draft"); setIssueDate(new Date().toISOString().slice(0, 10)); setDueDate(""); };

  const submit = async () => {
    try {
      await create.mutateAsync({
        number,
        client_id: clientId || null,
        client_name: byId.get(clientId)?.name || null,
        project: project || null,
        amount: amount ? Number(amount) : 0,
        status,
        issue_date: issueDate,
        due_date: dueDate || null,
        line_items: project && amount ? [{ description: project, amount: Number(amount) }] : [],
      });
      toast({ title: "Invoice created", description: number });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't create invoice", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New Invoice" onSubmit={submit} submitting={create.isPending} disabled={!number.trim()}>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Invoice number" value={number} onChange={setNumber} required />
        <NumberField label="Amount (€)" value={amount} onChange={setAmount} placeholder="12000" />
      </div>
      <SelectField label="Client" value={clientId} onChange={setClientId} options={clientOptions} />
      <TextField label="Project" value={project} onChange={setProject} placeholder="Project / description" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Issue date" value={issueDate} onChange={setIssueDate} type="date" />
        <TextField label="Due date" value={dueDate} onChange={setDueDate} type="date" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Status" value={status} onChange={setStatus} options={[
          { value: "draft", label: "Draft" }, { value: "sent", label: "Sent" }, { value: "viewed", label: "Viewed" }, { value: "partial", label: "Partially Paid" }, { value: "overdue", label: "Overdue" }, { value: "paid", label: "Paid" },
        ]} />
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Calendar event
// ---------------------------------------------------------------------------
export function CreateEventDialog({ open, onOpenChange, defaultDate }: DialogProps & { defaultDate?: string }) {
  const { toast } = useToast();
  const create = useCreateEvent();
  const { users } = useAppUserOptions();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [type, setType] = useState<"meeting" | "design" | "internal" | "milestone">("meeting");
  const [location, setLocation] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);

  const reset = () => { setTitle(""); setDate(defaultDate ?? new Date().toISOString().slice(0, 10)); setStart("10:00"); setEnd("11:00"); setType("meeting"); setLocation(""); setAttendees([]); };

  const toggleAttendee = (id: string) =>
    setAttendees((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

  const submit = async () => {
    try {
      await create.mutateAsync({
        title,
        event_date: date,
        start_time: start || null,
        end_time: end || null,
        type,
        location: location || null,
        attendee_user_ids: attendees,
      });
      toast({ title: "Event scheduled", description: title });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't schedule event", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Schedule Event" onSubmit={submit} submitting={create.isPending} disabled={!title.trim()}>
      <TextField label="Title" value={title} onChange={setTitle} required placeholder="Project kickoff" />
      <TextField label="Date" value={date} onChange={setDate} type="date" required />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Start time" value={start} onChange={setStart} type="time" />
        <TextField label="End time" value={end} onChange={setEnd} type="time" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Type" value={type} onChange={setType} options={[
          { value: "meeting", label: "Meeting" }, { value: "design", label: "Design" }, { value: "internal", label: "Internal" }, { value: "milestone", label: "Milestone" },
        ]} />
        <TextField label="Location" value={location} onChange={setLocation} placeholder="Google Meet" />
      </div>
      {users.length > 0 && (
        <Field label="Attendees">
          <div className="flex flex-wrap gap-2">
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => toggleAttendee(u.id)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  attendees.includes(u.id)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {profileDisplayName(u)}
              </button>
            ))}
          </div>
        </Field>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------
export function CreateTransactionDialog({ open, onOpenChange }: DialogProps) {
  const { toast } = useToast();
  const create = useCreateTransaction();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"income" | "expense">("expense");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const reset = () => { setDescription(""); setAmount(""); setType("expense"); setCategory(""); setDate(new Date().toISOString().slice(0, 10)); };

  const submit = async () => {
    const raw = Math.abs(Number(amount) || 0);
    const signed = type === "expense" ? -raw : raw;
    try {
      await create.mutateAsync({
        description,
        amount: signed,
        type,
        category: category || (type === "income" ? "Income" : "Other"),
        occurred_on: date,
      });
      toast({ title: "Transaction recorded", description });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't record transaction", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New Transaction" onSubmit={submit} submitting={create.isPending} disabled={!description.trim() || !amount}>
      <TextField label="Description" value={description} onChange={setDescription} required placeholder="Stripe payout / AWS bill" />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Type" value={type} onChange={setType} options={[
          { value: "income", label: "Income" }, { value: "expense", label: "Expense" },
        ]} />
        <NumberField label="Amount (€)" value={amount} onChange={setAmount} required placeholder="1200" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Category" value={category} onChange={setCategory} placeholder="Software, Payroll…" />
        <TextField label="Date" value={date} onChange={setDate} type="date" />
      </div>
    </FormDialog>
  );
}
