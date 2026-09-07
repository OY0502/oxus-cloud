import React, { useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useClients, useProjects, useStripeCreateInvoice } from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { invoiceSelectionForProject, invoiceProjectForCompany, projectBillingCompany, isInvoiceBillingCompany } from "@/lib/invoiceProjectSelection";

type LineItem = { description: string; quantity: string; unit_amount: string };

export function CreateInvoicePage() {
  const { data: clients = [], isLoading: clientsLoading, error: clientsError } = useClients();
  const { data: projects = [], isLoading: projectsLoading, error: projectsError } = useProjects();
  const createInvoice = useStripeCreateInvoice();
  const { toast } = useToast();

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

  const submit = async (action: "save_draft" | "finalize" | "finalize_and_send") => {
    if (!companyId) {
      toast({ title: "Select a client", variant: "destructive" });
      return;
    }
    const parsed = lineItems
      .map((li) => ({
        description: li.description.trim(),
        quantity: parseFloat(li.quantity) || 1,
        unit_amount: parseFloat(li.unit_amount) || 0,
      }))
      .filter((li) => li.description && li.unit_amount > 0);
    if (parsed.length === 0) {
      toast({ title: "Add at least one line item", variant: "destructive" });
      return;
    }
    try {
      const result = await createInvoice.mutateAsync({
        company_id: companyId,
        project_id: projectId || undefined,
        currency,
        due_date: dueDate || undefined,
        memo: memo || undefined,
        line_items: parsed,
        action,
      });
      toast({
        title: action === "save_draft" ? "Draft created" : "Invoice sent",
        description: result.hosted_invoice_url ? "Stripe hosted link saved." : undefined,
      });
    } catch (e) {
      toast({
        title: "Invoice failed",
        description: e instanceof Error ? e.message : "Check Stripe configuration.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild><Link href="/invoices"><ArrowLeft className="w-4 h-4" /></Link></Button>
        <PageHeader title="New invoice" subtitle="Create and send via Stripe." />
      </div>

      <Card>
        <CardHeader><CardTitle>Invoice details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {(clientsError || projectsError) && (
            <p role="alert" className="text-sm text-destructive">Could not load clients or projects. Refresh the page to try again.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    <SelectItem key={p.id} value={p.id}>{p.name}{projectBillingCompany(p) && ` — ${clients.find((c) => c.id === projectBillingCompany(p))?.name ?? "Linked client"}`}</SelectItem>
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
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
          <Button variant="outline" size="sm" onClick={addLine}><Plus className="w-4 h-4 mr-1" />Add line</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lineItems.map((li, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6 space-y-1">
                {i === 0 && <Label>Description</Label>}
                <Input value={li.description} onChange={(e) => {
                  const next = [...lineItems];
                  next[i] = { ...next[i], description: e.target.value };
                  setLineItems(next);
                }} />
              </div>
              <div className="col-span-2 space-y-1">
                {i === 0 && <Label>Qty</Label>}
                <Input type="number" value={li.quantity} onChange={(e) => {
                  const next = [...lineItems];
                  next[i] = { ...next[i], quantity: e.target.value };
                  setLineItems(next);
                }} />
              </div>
              <div className="col-span-3 space-y-1">
                {i === 0 && <Label>Unit amount</Label>}
                <Input type="number" value={li.unit_amount} onChange={(e) => {
                  const next = [...lineItems];
                  next[i] = { ...next[i], unit_amount: e.target.value };
                  setLineItems(next);
                }} />
              </div>
              <div className="col-span-1">
                {lineItems.length > 1 && (
                  <Button variant="ghost" size="icon" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4" /></Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={createInvoice.isPending} onClick={() => void submit("save_draft")}>Save draft</Button>
        <Button variant="outline" disabled={createInvoice.isPending} onClick={() => void submit("finalize")}>Finalize</Button>
        <Button disabled={createInvoice.isPending} onClick={() => void submit("finalize_and_send")}>Finalize & send</Button>
      </div>
    </div>
  );
}
