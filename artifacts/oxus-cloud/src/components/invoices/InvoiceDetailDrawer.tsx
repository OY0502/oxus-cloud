import React, { useMemo, useState } from "react";

import { EntityDrawer } from "@/components/EntityDrawer";

import { StatusBadge } from "@/components/StatusBadge";

import { Button } from "@/components/ui/button";

import { InvoiceActionMenu } from "@/components/invoices/InvoiceActionMenu";

import {

  Select,

  SelectContent,

  SelectItem,

  SelectTrigger,

  SelectValue,

} from "@/components/ui/select";

import {

  AlertDialog,

  AlertDialogAction,

  AlertDialogCancel,

  AlertDialogContent,

  AlertDialogDescription,

  AlertDialogFooter,

  AlertDialogHeader,

  AlertDialogTitle,

} from "@/components/ui/alert-dialog";

import { useToast } from "@/hooks/use-toast";

import {

  useProjects,

  useStripeInvoiceAction,

  useUpdateInvoiceProject,

  useRestoreInvoiceAttention,

} from "@/hooks/api";

import {

  type Invoice,

  INVOICE_STATUS,

  formatInvoiceAmount,

  formatInvoiceAmountEur,

  formatDate,

  invoiceTotal,

  remaining,

  lineItemsSubtotal,

  stripeDashboardUrl,

  getAvailableInvoiceActions,

  formatProviderLabel,

  formatSyncBadge,

  type StripeInvoiceActionType,

} from "@/lib/invoices";

import { formatCurrency } from "@/lib/currency";

import { Download, ExternalLink, RotateCcw } from "lucide-react";



interface InvoiceDetailDrawerProps {

  invoice: Invoice | null;

  open: boolean;

  onOpenChange: (open: boolean) => void;

  onStripeAction?: (invoice: Invoice, action: StripeInvoiceActionType) => void;

}



export function InvoiceDetailDrawer({ invoice, open, onOpenChange, onStripeAction }: InvoiceDetailDrawerProps) {

  const { data: projects = [] } = useProjects();

  const stripeAction = useStripeInvoiceAction();

  const updateProject = useUpdateInvoiceProject();

  const restoreAttention = useRestoreInvoiceAttention();

  const { toast } = useToast();

  const [confirmAction, setConfirmAction] = useState<StripeInvoiceActionType | null>(null);

  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);



  const clientProjects = useMemo(() => {

    if (!invoice?.clientId) return projects;

    return projects.filter(

      (p) => p.client_id === invoice.clientId || p.organization_id === invoice.clientId,

    );

  }, [projects, invoice?.clientId]);



  React.useEffect(() => {

    if (invoice) {

      setPendingProjectId(invoice.projectId);

    }

  }, [invoice?.id, invoice?.projectId]);



  if (!invoice) return null;



  const total = invoiceTotal(invoice);

  const balance = remaining(invoice);

  const subtotalFromLines = lineItemsSubtotal(invoice);

  const stripeUrl = stripeDashboardUrl(invoice);

  const isPaid = invoice.status === "paid" || (invoice.stripeStatus ?? "").toLowerCase() === "paid";

  const actions = getAvailableInvoiceActions(invoice);

  const providerBadge = formatProviderLabel(invoice.provider);

  const syncBadge = formatSyncBadge(invoice.syncStatus);

  const currencyCode = (invoice.currency ?? "EUR").toUpperCase();

  const eurEquivalent = formatInvoiceAmountEur(invoice);



  const runAction = async (action: StripeInvoiceActionType) => {

    try {

      const result = await stripeAction.mutateAsync({ invoice_id: invoice.id, action });

      toast({

        title: result.already_done ? "Already up to date" : "Invoice updated",

        description: result.message ?? `Stripe action "${action}" completed.`,

      });

      setConfirmAction(null);

    } catch (e) {

      toast({

        title: "Action failed",

        description: e instanceof Error ? e.message : "Could not complete Stripe action.",

        variant: "destructive",

      });

    }

  };



  const invokeAction = (action: StripeInvoiceActionType) => {

    if (onStripeAction) {

      onStripeAction(invoice, action);

      return;

    }

    if (action === "void" || action === "mark_uncollectible" || action === "delete_draft") {

      setConfirmAction(action);

      return;

    }

    void runAction(action);

  };



  const handleDrawerStripeAction = (_inv: Invoice, action: StripeInvoiceActionType) => {

    invokeAction(action);

  };



  const saveProject = async (projectId: string | null) => {

    try {

      const result = await updateProject.mutateAsync({ invoice_id: invoice.id, project_id: projectId });

      if (result.stripe_metadata_warning) {

        toast({ title: "Project saved", description: result.stripe_metadata_warning, variant: "destructive" });

      } else {

        toast({ title: "Project updated" });

      }

    } catch (e) {

      toast({ title: "Could not update project", description: e instanceof Error ? e.message : "", variant: "destructive" });

    }

  };



  const overflowHandlers = {

    onStripeAction: handleDrawerStripeAction,

  };



  const headerBtnClass = "h-9";



  return (

    <>

      <EntityDrawer

        open={open}

        onOpenChange={onOpenChange}

        title={invoice.number}

        description={

          <span className="flex flex-wrap items-center gap-1.5">

            <StatusBadge status={INVOICE_STATUS[invoice.status].label} variant={INVOICE_STATUS[invoice.status].variant} />

            <StatusBadge status={providerBadge} variant="neutral" />

            <StatusBadge status={syncBadge.label} variant={syncBadge.variant} />

            <StatusBadge status={currencyCode} variant="neutral" />

            {invoice.stripeStatus && invoice.stripeStatus !== "—" && (

              <span className="text-xs text-muted-foreground capitalize">Stripe: {invoice.stripeStatus}</span>

            )}

          </span>

        }

        headerActions={

          <>

            {invoice.hostedInvoiceUrl && (

              <Button variant="outline" className={headerBtnClass} asChild>

                <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">

                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden />

                  View invoice

                </a>

              </Button>

            )}

            {invoice.hostedInvoiceUrl && (

              <Button variant="outline" className={headerBtnClass} asChild>

                <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">

                  <Download className="mr-2 h-4 w-4" aria-hidden />

                  Download PDF

                </a>

              </Button>

            )}

            {stripeUrl && (

              <Button variant="outline" className={headerBtnClass} asChild>

                <a href={stripeUrl} target="_blank" rel="noopener noreferrer">

                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden />

                  Open in Stripe

                </a>

              </Button>

            )}

          </>

        }

      >

        <div className="space-y-5">

          <div className="grid gap-4 rounded-lg border border-card-border bg-card p-4 shadow-soft sm:grid-cols-[1fr_auto]">

            <div className="space-y-3 min-w-0">

              <div>

                <h4 className="section-label mb-0.5">Billed To</h4>

                <p className="font-medium">{invoice.client}</p>

              </div>

              <div>

                <h4 className="section-label mb-1">Project</h4>

                <Select

                  value={pendingProjectId ?? "__none__"}

                  onValueChange={(v) => {

                    const next = v === "__none__" ? null : v;

                    setPendingProjectId(next);

                    void saveProject(next);

                  }}

                >

                  <SelectTrigger className="h-9 w-full max-w-md">

                    <SelectValue placeholder="Select project" />

                  </SelectTrigger>

                  <SelectContent>

                    <SelectItem value="__none__">No project</SelectItem>

                    {(clientProjects.length > 0 ? clientProjects : projects).map((p) => (

                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>

                    ))}

                  </SelectContent>

                </Select>

              </div>

            </div>

            <div className="text-right shrink-0 sm:pl-4">

              <h4 className="section-label mb-1">{isPaid ? "Total Paid" : "Balance Due"}</h4>

              <p className="font-serif text-3xl font-bold text-primary tabular-nums leading-none">

                {formatCurrency(isPaid ? total : balance, currencyCode)}

              </p>

              <p className="mt-1 text-xs text-muted-foreground">

                {eurEquivalent !== "Not available" && currencyCode !== "EUR" && (

                  <span className="tabular-nums">{eurEquivalent} EUR · </span>

                )}

                <span className="tabular-nums">{formatCurrency(total, currencyCode)} total</span>

              </p>

              {!isPaid && invoice.amountPaid > 0 && (

                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">

                  {formatCurrency(invoice.amountPaid, currencyCode)} paid

                </p>

              )}

            </div>

          </div>



          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">

            <MetaItem label="Issue Date" value={formatDate(invoice.issueDate)} />

            <MetaItem label="Due Date" value={formatDate(invoice.dueDate)} />

            <MetaItem label="Provider" value={providerBadge} />

            <MetaItem label="Sync" value={syncBadge.label} />

            {invoice.paymentMethod && <MetaItem label="Payment Method" value={invoice.paymentMethod} />}

            {invoice.paidDate && <MetaItem label="Paid Date" value={formatDate(invoice.paidAt ?? invoice.paidDate)} />}

          </div>



          <div>

            <h4 className="mb-2 text-sm font-semibold">Line Items</h4>

            <div className="rounded-lg border border-border bg-card">

              {invoice.lineItems.map((item, i) => (

                <div key={i} className="grid grid-cols-12 gap-2 border-b border-border/50 px-3 py-2 text-sm last:border-0">

                  <span className="col-span-6 font-medium truncate">{item.description}</span>

                  <span className="col-span-2 text-muted-foreground text-right tabular-nums">×{item.quantity}</span>

                  <span className="col-span-2 text-muted-foreground text-right tabular-nums">{formatCurrency(item.unitAmount, currencyCode)}</span>

                  <span className="col-span-2 text-right font-medium tabular-nums">{formatCurrency(item.amount, currencyCode)}</span>

                </div>

              ))}

              <div className="space-y-1 border-t border-border/50 px-3 py-3 text-sm">

                <Row label="Subtotal (lines)" value={formatCurrency(subtotalFromLines, currencyCode)} />

                {invoice.subtotal > 0 && subtotalFromLines !== invoice.subtotal && (

                  <Row label="Subtotal (invoice)" value={formatCurrency(invoice.subtotal, currencyCode)} />

                )}

                {invoice.taxAmount > 0 && <Row label="Tax" value={formatCurrency(invoice.taxAmount, currencyCode)} />}

                <Row label="Total" value={formatCurrency(total, currencyCode)} bold />

                {invoice.amountPaid > 0 && <Row label="Paid" value={formatCurrency(invoice.amountPaid, currencyCode)} />}

                {!isPaid && balance > 0 && <Row label="Remaining" value={formatCurrency(balance, currencyCode)} bold />}

              </div>

            </div>

          </div>



          {invoice.attentionDismissedAt && (

            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">

              <span className="text-muted-foreground">Removed from Needs Attention</span>

              <Button

                variant="ghost"

                size="sm"

                className="h-8"

                onClick={() => {

                  restoreAttention.mutate(invoice.id, {

                    onSuccess: () => toast({ title: "Attention restored" }),

                  });

                }}

              >

                <RotateCcw className="mr-2 h-4 w-4" aria-hidden /> Restore

              </Button>

            </div>

          )}



          {isPaid ? (

            <div className="rounded-lg border border-success/20 bg-success-muted px-4 py-3 text-center text-sm font-medium text-success">

              Payment completed

            </div>

          ) : (actions.primary || actions.secondary || actions.drawerOverflow.length > 0) && (

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">

              {actions.primary?.stripeAction && (

                <Button

                  className="h-9"

                  disabled={stripeAction.isPending}

                  onClick={() => invokeAction(actions.primary!.stripeAction!)}

                >

                  {actions.primary.label}

                </Button>

              )}

              {actions.secondary?.stripeAction && (

                <Button

                  variant="outline"

                  className="h-9"

                  disabled={stripeAction.isPending}

                  onClick={() => invokeAction(actions.secondary!.stripeAction!)}

                >

                  {actions.secondary.label}

                </Button>

              )}

              {actions.drawerOverflow.length > 0 && (

                <InvoiceActionMenu

                  invoice={invoice}

                  actions={actions.drawerOverflow}

                  handlers={overflowHandlers}

                  trigger="button"

                  triggerLabel="More actions"

                  align="start"

                />

              )}

            </div>

          )}

        </div>

      </EntityDrawer>



      <AlertDialog open={!!confirmAction && !onStripeAction} onOpenChange={(o) => !o && setConfirmAction(null)}>

        <AlertDialogContent>

          <AlertDialogHeader>

            <AlertDialogTitle>Confirm invoice action</AlertDialogTitle>

            <AlertDialogDescription>

              This will update the invoice in Stripe and cannot always be undone. Continue?

            </AlertDialogDescription>

          </AlertDialogHeader>

          <AlertDialogFooter>

            <AlertDialogCancel>Cancel</AlertDialogCancel>

            <AlertDialogAction

              disabled={stripeAction.isPending}

              onClick={(e) => {

                e.preventDefault();

                if (confirmAction) void runAction(confirmAction);

              }}

            >

              Confirm

            </AlertDialogAction>

          </AlertDialogFooter>

        </AlertDialogContent>

      </AlertDialog>

    </>

  );

}



function MetaItem({ label, value }: { label: string; value: string }) {

  return (

    <div className="min-w-0">

      <span className="section-label">{label}</span>

      <p className="mt-0.5 truncate text-sm font-medium">{value}</p>

    </div>

  );

}



function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {

  return (

    <div className={`flex justify-between tabular-nums ${bold ? "text-sm font-semibold text-foreground pt-1" : "text-muted-foreground"}`}>

      <span>{label}</span>

      <span>{value}</span>

    </div>

  );

}


