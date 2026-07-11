import React, { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
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
import { SelectField, fromSelectValue, toSelectValue } from "@/components/forms/FormKit";
import { useAddTeamMember, useClients, useProjects, useCreateTeamActivity } from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import type { Availability } from "@/lib/types";
import {
  RateFormFields,
  DEFAULT_RATE_FORM,
  rateFormToInput,
  type RateFormValues,
} from "./RateForm";

interface AddTeamMemberDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (personId: string) => void;
}

export function AddTeamMemberDrawer({ open, onOpenChange, onCreated }: AddTeamMemberDrawerProps) {
  const { toast } = useToast();
  const addMember = useAddTeamMember();
  const logActivity = useCreateTeamActivity();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();

  const oxusCompanyId = useMemo(
    () => clients.find((c) => c.company_type === "internal" && c.name.toLowerCase() === "oxus")?.id ?? "",
    [clients],
  );

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [relationship, setRelationship] = useState<"employee" | "contractor">("contractor");
  const [availability, setAvailability] = useState<Availability>("full");
  const [location, setLocation] = useState("");
  const [stack, setStack] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [projectId, setProjectId] = useState("");
  const [notes, setNotes] = useState("");
  const [includeRate, setIncludeRate] = useState(false);
  const [rateValues, setRateValues] = useState<RateFormValues>(DEFAULT_RATE_FORM);

  const reset = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setJobTitle("");
    setRelationship("contractor");
    setAvailability("full");
    setLocation("");
    setStack([]);
    setStartDate("");
    setProjectId("");
    setNotes("");
    setIncludeRate(false);
    setRateValues({ ...DEFAULT_RATE_FORM, effectiveFrom: new Date().toISOString().slice(0, 10) });
  };

  const patchRate = (p: Partial<RateFormValues>) => setRateValues((v) => ({ ...v, ...p }));

  const submit = async () => {
    const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
    if (!name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (!oxusCompanyId) {
      toast({ title: "OXUS company not found", description: "Contact support.", variant: "destructive" });
      return;
    }
    try {
      let initialRate: ReturnType<typeof rateFormToInput> | undefined;
      if (includeRate) {
        const amount = parseFloat(rateValues.amount);
        if (amount > 0) {
          initialRate = rateFormToInput("pending", {
            ...rateValues,
            effectiveFrom: rateValues.effectiveFrom || startDate || new Date().toISOString().slice(0, 10),
          });
        }
      }

      const personId = await addMember.mutateAsync({
        contact: {
          name,
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          job_title: jobTitle.trim() || null,
          location: location.trim() || null,
          availability,
          stack,
          notes: notes.trim() || null,
          type: "contractor",
          metadata: startDate ? { start_date: startDate } : {},
        },
        relationship_type: relationship,
        oxus_company_id: oxusCompanyId,
        initial_rate: initialRate,
        project_id: projectId || null,
      });
      await logActivity.mutateAsync({
        contact_id: personId,
        title: "Team member added",
        description: name,
      });
      toast({ title: "Member added", description: name });
      reset();
      onOpenChange(false);
      onCreated?.(personId);
    } catch (e) {
      toast({
        title: "Could not add member",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[92vw] flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>Add team member</SheetTitle>
          <SheetDescription>
            Reuses an existing person when the email matches. Creates an OXUS company relationship automatically.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>First name</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
            <div className="space-y-1"><Label>Last name</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Job title</Label><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></div>
            <div className="space-y-1"><Label>Location</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Engagement</Label>
              <Select value={relationship} onValueChange={(v) => setRelationship(v as "employee" | "contractor")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Availability</Label>
              <Select value={availability} onValueChange={(v) => setAvailability(v as Availability)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Available</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="busy">Fully allocated</SelectItem>
                  <SelectItem value="unavailable">Unavailable</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label>Start date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="space-y-1"><Label>Tech stack</Label><TagInput value={stack} onChange={setStack} placeholder="React, Node…" /></div>

          <SelectField
            label="Assign to project (optional)"
            value={toSelectValue(projectId)}
            onChange={(v) => setProjectId(fromSelectValue(v))}
            options={[
              { value: toSelectValue(""), label: "— None —" },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />

          <div className="rounded-lg border border-border/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Initial rate (optional)</Label>
              <Button
                type="button"
                size="sm"
                variant={includeRate ? "default" : "outline"}
                onClick={() => setIncludeRate((v) => !v)}
              >
                {includeRate ? "Included" : "Add rate"}
              </Button>
            </div>
            {includeRate && (
              <RateFormFields
                values={rateValues}
                onChange={patchRate}
                projects={projects}
              />
            )}
          </div>

          <div className="space-y-1"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <div className="border-t px-6 py-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={addMember.isPending}>
            {addMember.isPending ? "Adding…" : "Add member"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
