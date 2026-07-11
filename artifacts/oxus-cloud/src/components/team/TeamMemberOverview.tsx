import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagInput } from "@/components/forms/Inputs";
import { StatusBadge } from "@/components/StatusBadge";
import { useUpdateTeamMember, useCreateTeamActivity, useCompanyPeople } from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import {
  availabilityLabel,
  availabilityVariant,
  engagementLabel,
  engagementVariant,
  mergeTeamMetadata,
  parseTeamMetadata,
  personStatusVariant,
  formatRate,
  deactivatedAtLabel,
  isPersonInactive,
} from "@/lib/team";
import type { Availability, Contact, TeamMemberFinancialSummary } from "@/lib/types";
import type { Json } from "@/lib/database.types";
import { formatEUR } from "@/lib/currency";
import {
  TeamChip,
  TeamDetailGrid,
  TeamDetailItem,
  TeamPanelSection,
  TeamPrimaryButton,
  teamActionBtn,
} from "./teamUi";

interface TeamMemberOverviewProps {
  person: Contact;
  summary?: TeamMemberFinancialSummary | null;
  canEdit: boolean;
  showFinancials?: boolean;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

export function TeamMemberOverview({
  person,
  summary,
  canEdit,
  showFinancials = false,
  editing: editingProp,
  onEditingChange,
}: TeamMemberOverviewProps) {
  const { toast } = useToast();
  const updateMember = useUpdateTeamMember();
  const logActivity = useCreateTeamActivity();
  const { data: companyPeople = [] } = useCompanyPeople();
  const meta = parseTeamMetadata(person);
  const inactive = isPersonInactive(person);

  const [editingInternal, setEditingInternal] = useState(false);
  const editing = editingProp ?? editingInternal;
  const setEditing = onEditingChange ?? setEditingInternal;

  const [firstName, setFirstName] = useState(person.first_name ?? "");
  const [lastName, setLastName] = useState(person.last_name ?? "");
  const [email, setEmail] = useState(person.email ?? "");
  const [phone, setPhone] = useState(person.phone ?? "");
  const [location, setLocation] = useState(person.location ?? "");
  const [jobTitle, setJobTitle] = useState(person.job_title ?? "");
  const [employment, setEmployment] = useState(person.employment_type ?? "contractor");
  const [status, setStatus] = useState(person.person_status ?? "active");
  const [availability, setAvailability] = useState<Availability>((person.availability as Availability) ?? "full");
  const [stack, setStack] = useState<string[]>(person.stack ?? []);
  const [notes, setNotes] = useState(person.notes ?? "");
  const [weeklyHours, setWeeklyHours] = useState(meta.weekly_available_hours != null ? String(meta.weekly_available_hours) : "");
  const [capacityPercent, setCapacityPercent] = useState(meta.capacity_percent != null ? String(meta.capacity_percent) : "");
  const [startDate, setStartDate] = useState(meta.start_date ?? "");
  const [endDate, setEndDate] = useState(meta.end_date ?? "");
  const [internalNotes, setInternalNotes] = useState(meta.internal_notes ?? "");
  const [defaultCurrency, setDefaultCurrency] = useState(meta.default_currency ?? "EUR");
  const [paymentTerms, setPaymentTerms] = useState(meta.payment_terms ?? "");

  useEffect(() => {
    setFirstName(person.first_name ?? "");
    setLastName(person.last_name ?? "");
    setEmail(person.email ?? "");
    setPhone(person.phone ?? "");
    setLocation(person.location ?? "");
    setJobTitle(person.job_title ?? "");
    setEmployment(person.employment_type ?? "contractor");
    setStatus(person.person_status ?? "active");
    setAvailability((person.availability as Availability) ?? "full");
    setStack(person.stack ?? []);
    setNotes(person.notes ?? "");
    const m = parseTeamMetadata(person);
    setWeeklyHours(m.weekly_available_hours != null ? String(m.weekly_available_hours) : "");
    setCapacityPercent(m.capacity_percent != null ? String(m.capacity_percent) : "");
    setStartDate(m.start_date ?? "");
    setEndDate(m.end_date ?? "");
    setInternalNotes(m.internal_notes ?? "");
    setDefaultCurrency(m.default_currency ?? "EUR");
    setPaymentTerms(m.payment_terms ?? "");
    if (editingProp === undefined) setEditingInternal(false);
  }, [person, editingProp]);

  const displayName = [firstName, lastName].filter(Boolean).join(" ") || person.name;

  const cancel = () => {
    setEditing(false);
    setFirstName(person.first_name ?? "");
    setLastName(person.last_name ?? "");
    setEmail(person.email ?? "");
    setPhone(person.phone ?? "");
    setLocation(person.location ?? "");
    setJobTitle(person.job_title ?? "");
    setEmployment(person.employment_type ?? "contractor");
    setStatus(person.person_status ?? "active");
    setAvailability((person.availability as Availability) ?? "full");
    setStack(person.stack ?? []);
    setNotes(person.notes ?? "");
  };

  const save = async () => {
    if (!firstName.trim() && !lastName.trim() && !person.name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || person.name;
    try {
      await updateMember.mutateAsync({
        id: person.id,
        patch: {
          name,
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          location: location.trim() || null,
          job_title: jobTitle.trim() || null,
          employment_type: employment,
          person_status: status,
          availability,
          stack,
          notes: notes.trim() || null,
          metadata: mergeTeamMetadata(person, {
            weekly_available_hours: weeklyHours ? parseFloat(weeklyHours) : null,
            capacity_percent: capacityPercent ? parseFloat(capacityPercent) : null,
            start_date: startDate || null,
            end_date: endDate || null,
            internal_notes: internalNotes.trim() || null,
            default_currency: defaultCurrency || "EUR",
            payment_terms: paymentTerms.trim() || null,
          }) as Json,
        },
      });
      await logActivity.mutateAsync({
        contact_id: person.id,
        title: "Profile updated",
        description: "Team member details saved",
      });
      toast({ title: "Saved", description: "Member details updated." });
      setEditing(false);
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  if (editing) {
    return (
      <div className="space-y-4">
        <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-2 border-b border-border/60 bg-background/95 px-1 py-2 backdrop-blur-sm">
          <h3 className="text-sm font-medium">Edit member</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className={teamActionBtn.secondary} onClick={cancel} disabled={updateMember.isPending}>
              Cancel
            </Button>
            <TeamPrimaryButton onClick={() => void save()} disabled={updateMember.isPending}>
              {updateMember.isPending ? "Saving…" : "Save"}
            </TeamPrimaryButton>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>First name</Label><Input className="h-9 text-sm" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
          <div className="space-y-1"><Label>Last name</Label><Input className="h-9 text-sm" value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Email</Label><Input className="h-9 text-sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1"><Label>Phone</Label><Input className="h-9 text-sm" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Location</Label><Input className="h-9 text-sm" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
          <div className="space-y-1"><Label>Role / title</Label><Input className="h-9 text-sm" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Engagement</Label>
            <Select value={employment} onValueChange={setEmployment}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="contractor">Contractor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Availability</Label>
            <Select value={availability} onValueChange={(v) => setAvailability(v as Availability)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Available</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="busy">Fully allocated</SelectItem>
                <SelectItem value="unavailable">Unavailable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Weekly available hours</Label><Input className="h-9 text-sm" type="number" value={weeklyHours} onChange={(e) => setWeeklyHours(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Capacity %</Label><Input className="h-9 text-sm" type="number" value={capacityPercent} onChange={(e) => setCapacityPercent(e.target.value)} /></div>
          <div className="space-y-1"><Label>Default currency</Label><Input className="h-9 text-sm" value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Start date</Label><Input className="h-9 text-sm" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="space-y-1"><Label>End date</Label><Input className="h-9 text-sm" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        <div className="space-y-1"><Label>Technology stack</Label><TagInput value={stack} onChange={setStack} placeholder="React, TypeScript…" /></div>
        <div className="space-y-1"><Label>Notes</Label><Textarea className="text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        {showFinancials && (
          <>
            <div className="space-y-1"><Label>Payment terms</Label><Input className="h-9 text-sm" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></div>
            <div className="space-y-1"><Label>Internal notes</Label><Textarea className="text-sm" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} /></div>
          </>
        )}
      </div>
    );
  }

  const deactivated = deactivatedAtLabel(person);

  return (
    <div className="space-y-3">
      <TeamPanelSection title="Member details">
        <TeamDetailGrid>
          <TeamDetailItem label="Name">{displayName}</TeamDetailItem>
          <TeamDetailItem label="Email">{person.email ?? "—"}</TeamDetailItem>
          <TeamDetailItem label="Phone">{person.phone ?? "—"}</TeamDetailItem>
          <TeamDetailItem label="Location">{person.location ?? "—"}</TeamDetailItem>
          <TeamDetailItem label="Role">{person.job_title ?? "—"}</TeamDetailItem>
          <TeamDetailItem label="Engagement">
            <StatusBadge status={engagementLabel(person, companyPeople)} variant={engagementVariant()} />
          </TeamDetailItem>
          <TeamDetailItem label="Start date">{meta.start_date ?? "—"}</TeamDetailItem>
          <TeamDetailItem label="Status">
            <StatusBadge
              status={inactive ? "Inactive" : "Active"}
              variant={personStatusVariant(person.person_status)}
            />
          </TeamDetailItem>
          <TeamDetailItem label="Availability">
            {inactive ? "—" : (
              <StatusBadge status={availabilityLabel(person.availability)} variant={availabilityVariant(person.availability)} />
            )}
          </TeamDetailItem>
          {inactive && deactivated && (
            <TeamDetailItem label="Deactivated">{deactivated}</TeamDetailItem>
          )}
        </TeamDetailGrid>
      </TeamPanelSection>

      <TeamPanelSection title="Skills">
        {person.stack.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {person.stack.map((t) => (
              <TeamChip key={t}>{t}</TeamChip>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No skills listed.</p>
        )}
      </TeamPanelSection>

      <TeamPanelSection title="Operational summary">
        <TeamDetailGrid>
          {showFinancials && summary?.current_rate && (
            <TeamDetailItem label="Current rate">
              <span className="font-serif tabular-nums">{formatRate(summary.current_rate)}</span>
            </TeamDetailItem>
          )}
          {showFinancials && (
            <>
              <TeamDetailItem label="Paid this month">
                <span className="font-serif tabular-nums">{formatEUR(summary?.paid_mtd ?? 0)}</span>
              </TeamDetailItem>
              <TeamDetailItem label="Paid this year">
                <span className="font-serif tabular-nums">{formatEUR(summary?.paid_ytd ?? 0)}</span>
              </TeamDetailItem>
              <TeamDetailItem label="Outstanding invoices">
                <span className="font-serif tabular-nums">{formatEUR(summary?.outstanding_invoices ?? 0)}</span>
              </TeamDetailItem>
            </>
          )}
          <TeamDetailItem label="Active projects">{summary?.active_projects ?? 0}</TeamDetailItem>
          <TeamDetailItem label="Available capacity">{summary?.available_capacity ?? "—"}</TeamDetailItem>
        </TeamDetailGrid>
      </TeamPanelSection>

      {(person.notes || (showFinancials && meta.internal_notes)) && (
        <TeamPanelSection title="Notes">
          <div className="space-y-2 text-sm">
            {person.notes && <p>{person.notes}</p>}
            {showFinancials && meta.internal_notes && (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Internal: </span>
                {meta.internal_notes}
              </p>
            )}
          </div>
        </TeamPanelSection>
      )}
    </div>
  );
}
