import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { PriorityInvoiceCard } from "@/components/PriorityInvoiceCard";
import { InvoiceDetailDrawer } from "@/components/invoices/InvoiceDetailDrawer";
import { InvoiceActionMenu } from "@/components/invoices/InvoiceActionMenu";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  useInvoices,
  useStripeSyncInvoices,
  useStripeInvoiceAction,
  useDismissInvoiceAttention,
} from "@/hooks/api";
import { TableSkeleton, CardGridSkeleton, EmptyState, ErrorState } from "@/components/states/QueryStates";
import {
  type Invoice,
  type InvoiceStatus,
  TODAY,
  INVOICE_STATUS,
  daysBetween,
  isDueSoon,
  needsAttention,
  attentionRank,
  remaining,
  formatMoney,
  formatInvoiceAmount,
  formatInvoiceAmountEur,
  formatDate,
  invoiceFromRow,
  invoiceTotal,
  getAvailableInvoiceActions,
  formatProviderLabel,
  formatSyncBadge,
  formatPaymentTiming,
  type StripeInvoiceActionType,
} from "@/lib/invoices";
import {
  Plus,
  Search,
  Wallet,
  AlertTriangle,
  CalendarClock,
  TrendingUp,
  Clock,
  RefreshCw,
  Receipt,
  CheckCircle2,
} from "lucide-react";

type DateRange = "all" | "month" | "quarter" | "overdue-window";

const DESTRUCTIVE_ACTIONS = new Set<StripeInvoiceActionType>([
  "void",
  "mark_uncollectible",
  "delete_draft",
]);

export function Invoices() {
  const { data: rows = [], isLoading, isError, error, refetch } = useInvoices();
  const syncStripe = useStripeSyncInvoices();
  const stripeAction = useStripeInvoiceAction();
  const dismissAttention = useDismissInvoiceAttention();
  const { toast } = useToast();

  const invoices = useMemo<Invoice[]>(() => rows.map(invoiceFromRow), [rows]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const selectedInvoice = useMemo(
    () => invoices.find((i) => i.id === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId],
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [attentionIndex, setAttentionIndex] = useState(0);
  const [confirmAction, setConfirmAction] = useState<{ invoiceId: string; action: StripeInvoiceActionType } | null>(null);

  const clients = useMemo(() => Array.from(new Set(invoices.map((i) => i.client))).sort(), [invoices]);

  const metrics = useMemo(() => {
    const owedStatuses: InvoiceStatus[] = ["sent", "viewed", "partial", "overdue"];
    const outstanding = invoices.filter((i) => owedStatuses.includes(i.status)).reduce((s, i) => s + remaining(i), 0);
    const overdue = invoices.filter((i) => i.status === "overdue").reduce((s, i) => s + remaining(i), 0);
    const dueThisWeek = invoices.filter((i) => isDueSoon(i, 7)).reduce((s, i) => s + remaining(i), 0);
    const now = TODAY;
    const paidInvoices = invoices.filter((i) => i.status === "paid");
    const paidThisMonth = paidInvoices
      .filter((i) => {
        const d = new Date(i.paidAt ?? i.paidDate ?? i.dueDate);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((s, i) => s + invoiceTotal(i), 0);
    const delays = paidInvoices.map((i) => daysBetween(new Date(i.paidAt ?? i.paidDate ?? i.dueDate), new Date(i.dueDate)));
    const avgDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;
    return { outstanding, overdue, dueThisWeek, paidThisMonth, avgDelay };
  }, [invoices]);

  const paymentTiming = useMemo(() => formatPaymentTiming(metrics.avgDelay), [metrics.avgDelay]);

  const attentionInvoices = useMemo(
    () => invoices.filter(needsAttention).sort((a, b) => attentionRank(a) - attentionRank(b) || remaining(b) - remaining(a)),
    [invoices],
  );

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (overdueOnly && inv.status !== "overdue") return false;
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (clientFilter !== "all" && inv.client !== clientFilter) return false;
      if (dateRange !== "all") {
        const issued = new Date(inv.issueDate);
        const diff = daysBetween(TODAY, issued);
        if (dateRange === "month" && (issued.getMonth() !== TODAY.getMonth() || issued.getFullYear() !== TODAY.getFullYear())) return false;
        if (dateRange === "quarter" && (diff > 90 || diff < 0)) return false;
        if (dateRange === "overdue-window" && diff > 30) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const haystack = `${inv.number} ${inv.client} ${inv.project}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, overdueOnly, statusFilter, clientFilter, dateRange, search]);

  const runStripeAction = async (invoiceId: string, action: StripeInvoiceActionType) => {
    try {
      const result = await stripeAction.mutateAsync({ invoice_id: invoiceId, action });
      toast({
        title: result.already_done ? "Already up to date" : "Invoice updated in Stripe",
        description: result.message,
      });
      setConfirmAction(null);
    } catch (e) {
      toast({ title: "Action failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const handleStripeAction = (invoice: Invoice, action: StripeInvoiceActionType) => {
    if (DESTRUCTIVE_ACTIONS.has(action)) {
      setConfirmAction({ invoiceId: invoice.id, action });
    } else {
      void runStripeAction(invoice.id, action);
    }
  };

  const copyLink = (inv: Invoice) => {
    const url = inv.hostedInvoiceUrl;
    if (!url) {
      toast({ title: "No payment link", variant: "destructive" });
      return;
    }
    void navigator.clipboard.writeText(url);
    toast({ title: "Link copied" });
  };

  const dismissInvoice = (inv: Invoice) => {
    dismissAttention.mutate({ invoice_id: inv.id }, {
      onSuccess: () => {
        toast({ title: "Dismissed from Needs Attention" });
        setAttentionIndex((i) => Math.min(i, Math.max(0, attentionInvoices.length - 2)));
      },
    });
  };

  const actionHandlers = {
    onView: (inv: Invoice) => setSelectedInvoiceId(inv.id),
    onAssignProject: (inv: Invoice) => setSelectedInvoiceId(inv.id),
    onCopyLink: copyLink,
    onStripeAction: handleStripeAction,
  };

  return (
    <div className="w-full min-w-0 space-y-12">
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            Invoices
            {attentionInvoices.length === 0 && !isLoading && !isError && rows.length > 0 && (
              <Badge variant="outline" className="h-6 gap-1 border-success/30 bg-success-muted text-success font-normal">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                All clear
              </Badge>
            )}
          </span>
        }
        subtitle="Track every invoice from draft to paid. Stripe is the source of truth for synced invoices."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={syncStripe.isPending}
              title="Pull the latest invoice and payment changes from Stripe."
              onClick={() => {
                syncStripe.mutate(undefined, {
                  onSuccess: (r) => toast({
                    title: "Sync latest complete",
                    description: `${r.imported} imported, ${r.updated} updated, ${r.unchanged} unchanged.`,
                  }),
                  onError: (e) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
                });
              }}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${syncStripe.isPending ? "animate-spin" : ""}`} /> Sync latest
            </Button>
            <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/invoices/new"><Plus className="mr-2 h-4 w-4" /> New Invoice</Link>
            </Button>
          </div>
        }
      />

      {isError && <ErrorState error={error} onRetry={() => refetch()} />}

      {isLoading ? (
        <>
          <CardGridSkeleton count={5} />
          <TableSkeleton columns={6} />
        </>
      ) : !isError && rows.length === 0 ? (
        <EmptyState icon={<Receipt />} title="No invoices yet" description="Create or sync invoices to get started." />
      ) : !isError ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard title="Outstanding Balance" value={formatMoney(metrics.outstanding)} className="bg-primary text-primary-foreground border-primary" valueClassName="text-primary-foreground" icon={<Wallet className="h-5 w-5 text-primary-foreground/50" />} />
            <MetricCard title="Overdue Amount" value={formatMoney(metrics.overdue)} valueClassName="text-danger" icon={<AlertTriangle className="h-5 w-5" />} />
            <MetricCard title="Due This Week" value={formatMoney(metrics.dueThisWeek)} valueClassName="text-warning" icon={<CalendarClock className="h-5 w-5" />} />
            <MetricCard title="Paid This Month" value={formatMoney(metrics.paidThisMonth)} valueClassName="text-success" icon={<TrendingUp className="h-5 w-5" />} />
            <MetricCard title={paymentTiming.title} value={paymentTiming.value} valueClassName={paymentTiming.valueClassName} icon={<Clock className="h-5 w-5" />} />
          </div>

          {attentionInvoices.length > 0 && (
            <section>
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold tracking-tight">Needs Attention</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Overdue, due soon, and drafts. Dismiss permanently when handled.</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-muted-foreground">{attentionIndex + 1} of {attentionInvoices.length}</span>
                  <button
                    type="button"
                    aria-label="Previous attention invoice"
                    onClick={() => setAttentionIndex((i) => Math.max(0, i - 1))}
                    disabled={attentionIndex === 0}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-muted disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronPrev />
                  </button>
                  <button
                    type="button"
                    aria-label="Next attention invoice"
                    onClick={() => setAttentionIndex((i) => Math.min(attentionInvoices.length - 1, i + 1))}
                    disabled={attentionIndex === attentionInvoices.length - 1}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-muted disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronNext />
                  </button>
                </div>
              </div>
              <PriorityInvoiceCard
                invoice={attentionInvoices[attentionIndex]}
                onView={() => setSelectedInvoiceId(attentionInvoices[attentionIndex].id)}
                onDismiss={() => dismissInvoice(attentionInvoices[attentionIndex])}
                onStripeAction={(action) => handleStripeAction(attentionInvoices[attentionIndex], action)}
              />
            </section>
          )}

          <section>
            <div className="mb-5 flex items-baseline justify-between">
              <h3 className="text-xl font-bold">All Invoices</h3>
              <span className="text-xs text-muted-foreground">{filteredInvoices.length} of {invoices.length}</span>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search invoice, client, project…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as InvoiceStatus | "all")}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {(Object.keys(INVOICE_STATUS) as InvoiceStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{INVOICE_STATUS[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={clientFilter} onValueChange={setClientFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  {clients.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={overdueOnly} onCheckedChange={setOverdueOnly} />
                Overdue only
              </label>
            </div>
            <DataTable
              tableId="invoices"
              data={filteredInvoices}
              onRowClick={(inv) => setSelectedInvoiceId(inv.id)}
              columns={[
                {
                  id: "number",
                  header: "Invoice",
                  defaultWidth: 120,
                  cell: (i: Invoice) => (
                    <span className="font-mono text-xs text-muted-foreground">{i.number}</span>
                  ),
                },
                { id: "client", header: "Client", accessorKey: "client", className: "font-medium", defaultWidth: 160 },
                { id: "project", header: "Project", defaultWidth: 140, cell: (i: Invoice) => <span className="text-muted-foreground">{i.project === "—" ? "—" : i.project}</span> },
                {
                  id: "amount_orig",
                  header: "Amount (Orig)",
                  className: "text-right",
                  defaultWidth: 130,
                  cell: (i: Invoice) => (
                    <span className="font-semibold tabular-nums">{formatInvoiceAmount(i)}</span>
                  ),
                },
                {
                  id: "amount_eur",
                  header: "Amount (EUR)",
                  className: "text-right",
                  defaultWidth: 130,
                  cell: (i: Invoice) => {
                    const eur = formatInvoiceAmountEur(i);
                    return (
                      <span className={cn("tabular-nums", eur === "Not available" ? "text-muted-foreground text-xs" : "font-medium")}>
                        {eur}
                      </span>
                    );
                  },
                },
                {
                  id: "provider",
                  header: "Provider",
                  defaultWidth: 100,
                  cell: (i: Invoice) => (
                    <StatusBadge status={formatProviderLabel(i.provider)} variant="neutral" />
                  ),
                },
                {
                  id: "status",
                  header: "Status",
                  defaultWidth: 110,
                  cell: (i: Invoice) => (
                    <StatusBadge status={INVOICE_STATUS[i.status].label} variant={INVOICE_STATUS[i.status].variant} />
                  ),
                },
                { id: "due", header: "Due", defaultWidth: 100, cell: (i: Invoice) => <span className="tabular-nums">{formatDate(i.dueDate)}</span> },
                { id: "paid", header: "Paid", defaultWidth: 100, cell: (i: Invoice) => <span className="tabular-nums">{formatDate(i.paidAt ?? i.paidDate)}</span> },
                {
                  id: "sync",
                  header: "Sync",
                  defaultWidth: 100,
                  cell: (i: Invoice) => {
                    const sync = formatSyncBadge(i.syncStatus);
                    return <StatusBadge status={sync.label} variant={sync.variant} />;
                  },
                },
                {
                  id: "actions",
                  header: "",
                  resizable: false,
                  defaultWidth: 48,
                  minWidth: 48,
                  className: "w-px",
                  cell: (i: Invoice) => (
                    <InvoiceActionMenu
                      invoice={i}
                      actions={getAvailableInvoiceActions(i).overflow}
                      handlers={actionHandlers}
                    />
                  ),
                },
              ]}
            />
          </section>
        </>
      ) : null}

      <InvoiceDetailDrawer
        invoice={selectedInvoice}
        open={!!selectedInvoiceId}
        onOpenChange={(open) => !open && setSelectedInvoiceId(null)}
        onStripeAction={handleStripeAction}
      />

      <AlertDialog open={!!confirmAction} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm invoice action</AlertDialogTitle>
            <AlertDialogDescription>
              This updates the invoice in Stripe and may be irreversible. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmAction) void runStripeAction(confirmAction.invoiceId, confirmAction.action);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChevronPrev() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m15 18-6-6 6-6"/></svg>;
}
function ChevronNext() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m9 18 6-6-6-6"/></svg>;
}
