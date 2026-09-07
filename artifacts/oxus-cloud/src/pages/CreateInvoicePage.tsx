import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useClients, useProjects, useCreateManualInvoice } from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { invoiceSelectionForProject, invoiceProjectForCompany, projectBillingCompany, isInvoiceBillingCompany } from "@/lib/invoiceProjectSelection";

import { parseManualInvoiceLines, manualInvoiceTotal, type ManualInvoiceLineInput as LineItem } from "@/lib/manualInvoice";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currency";

export function CreateInvoicePage() {
  const { data: clients = [], isLoading: clientsLoading, error: clientsError } = useClients();
  const { data: projects = [], isLoading: projectsLoading, error: projectsError } = useProjects();
  const createInvoice = useCreateManualInvoice();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [invoiceId] = useState(() => crypto.randomUUID());
  const [number, setNumber] = useState("");
  const [issueDate, setIssueDate] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [dueDate, setDueDate] = useState("");
  const [memo, setMemo] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: "1", unit_amount: "" },
  ]);

  const billingClients = clients.filter((client) => isInvoiceBillingCompany(client, projects));

  const selectCompany = (id: string) => {
    setCompanyId(id);
    setProjectId(invoiceProjectForCompany(projects.find((project) => project.id === projectId), id));
  };
  const selectProject = (id: string) => {
    const project = projects.find((project) => project.id === id);
    if (!project) { setProjectId(""); return; }
    const selection = invoiceSelectionForProject(project, companyId);
    setProjectId(selection.projectId);
    setCompanyId(selection.companyId);
  };

  const addLine = () => setLineItems((items) => [...items, { description: "", quantity: "1", unit_amount: "" }]);
  const removeLine = (i: number) => setLineItems((items) => items.filter((_, idx) => idx !== i));

  let total = 0;
  try { total = manualInvoiceTotal(parseManualInvoiceLines(lineItems)); } catch { /* Incomplete lines are validated on save. */ }

  const submit = async () => {
    if (createInvoice.isPending) return;
    try {
      if (!companyId) throw new Error("Select a client.");
      if (!issueDate) throw new Error("Enter an issue date.");
      if (dueDate && dueDate < issueDate) throw new Error("Due date cannot be before the issue date.");
      const result = await createInvoice.mutateAsync({
        id: invoiceId,
        number: number.trim() || undefined,
        company_id: companyId,
        project_id: projectId || undefined,
        currency,
        issue_date: issueDate,
        due_date: dueDate || undefined,
        memo: memo.trim() || undefined,
        line_items: parseManualInvoiceLines(lineItems),
      });
      toast({ title: "Manual invoice saved", description: `${result.number} saved in OXUS.` });
      navigate("/invoices");
    } catch (e) {
      toast({ title: "Could not save invoice", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    }
  };

  return (
    <form className="space-y-6 max-w-3xl" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={createInvoice.isPending} className="space-y-6">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="icon" asChild><Link href="/invoices"><ArrowLeft className="w-4 h-4" /></Link></Button>
        <PageHeader title="New manual invoice" subtitle="Record an invoice in OXUS. Nothing is created in Stripe or sent to the client." />
      </div>

      <Card>
        <CardHeader><CardTitle>Invoice details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {(clientsError || projectsError) && (
            <p role="alert" className="text-sm text-destructive">Could not load clients or projects. Refresh the page to try again.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="invoice-number">Invoice reference (optional)</Label>
              <Input id="invoice-number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Generated automatically if left blank" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-issued">Issue date</Label>
              <Input id="invoice-issued" type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Client company</Label>
              <Select value={companyId} onValueChange={selectCompany} disabled={clientsLoading || projectsLoading}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {billingClients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Project (optional)</Label>
              <Select value={projectId} onValueChange={selectProject} disabled={clientsLoading || projectsLoading}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}{projectBillingCompany(p) && ` â€” ${clients.find((c) => c.id === projectBillingCompany(p))?.name ?? "Linked client"}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Choosing a project selects its linked client for billing.</p>
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due date</Label>
              <Input type="date" min={issueDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Memo</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Line items</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="w-4 h-4 mr-1" />Add line</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lineItems.map((li, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6 space-y-1">
                {i === 0 && <Label>Description</Label>}
                <Input aria-label={`Line ${i + 1} description`} required value={li.description} onChange={(e) => {
                  const next = [...lineItems];
                  next[i] = { ...next[i], description: e.target.value };
                  setLineItems(next);
                }} />
              </div>
              <div className="col-span-2 space-y-1">
                {i === 0 && <Label>Qty</Label>}
                <Input aria-label={`Line ${i + 1} quantity`} type="number" min="0.01" step="0.01" required value={li.quantity} onChange={(e) => {
                  const next = [...lineItems];
                  next[i] = { ...next[i], quantity: e.target.value };
                  setLineItems(next);
                }} />
              </div>
              <div className="col-span-3 space-y-1">
                {i === 0 && <Label>Unit amount</Label>}
                <Input aria-label={`Line ${i + 1} unit amount`} type="number" min="0.01" step="0.01" required value={li.unit_amount} onChange={(e) => {
                  const next = [...lineItems];
                  next[i] = { ...next[i], unit_amount: e.target.value };
                  setLineItems(next);
                }} />
              </div>
              <div className="col-span-1">
                {lineItems.length > 1 && (
                  <Button type="button" aria-label={`Remove line ${i + 1}`} variant="ghost" size="icon" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4" /></Button>
                )}
              </div>
            </div>
          ))}
          <div className="flex justify-between border-t pt-4 font-semibold"><span>Total</span><span>{formatCurrency(total, currency)}</span></div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Saved as a manual draft for internal tracking.</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" asChild><Link href="/invoices">Cancel</Link></Button>
          <Button type="submit" disabled={clientsLoading || projectsLoading || !!clientsError || !!projectsError}>
            {createInvoice.isPending ? "Saving…" : "Save manual invoice"}
          </Button>
        </div>
      </div>
      </fieldset>
    </form>
  );
}
