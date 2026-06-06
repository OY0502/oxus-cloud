import React, { useMemo, useState } from "react";
import { invoicesData } from "@/data/mock";
import { PriorityInvoiceCard } from "@/components/PriorityInvoiceCard";
import { InvoiceLifecycleBoard } from "@/components/InvoiceLifecycleBoard";
import { DataTable } from "@/components/DataTable";
import { EntityDrawer } from "@/components/EntityDrawer";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
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
  formatDate,
} from "@/lib/invoices";
import {
  Plus,
  Download,
  Search,
  Wallet,
  AlertTriangle,
  CalendarClock,
  TrendingUp,
  Clock,
  MoreHorizontal,
  Eye,
  CheckCircle2,
  Bell,
} from "lucide-react";

type DateRange = "all" | "month" | "quarter" | "overdue-window";

export function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>(invoicesData as Invoice[]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const { toast } = useToast();

  const clients = useMemo(() => Array.from(new Set(invoices.map((i) => i.client))).sort(), [invoices]);

  const metrics = useMemo(() => {
    const owedStatuses: InvoiceStatus[] = ["sent", "viewed", "partial", "overdue"];
    const outstanding = invoices.filter((i) => owedStatuses.includes(i.status)).reduce((s, i) => s + remaining(i), 0);
    const overdue = invoices.filter((i) => i.status === "overdue").reduce((s, i) => s + remaining(i), 0);
    const dueThisWeek = invoices.filter((i) => isDueSoon(i, 7)).reduce((s, i) => s + remaining(i), 0);

    const paidInvoices = invoices.filter((i) => i.status === "paid");
    const paidThisMonth = paidInvoices
      .filter((i) => {
        const d = new Date(i.paidDate || i.dueDate);
        return d.getMonth() === TODAY.getMonth() && d.getFullYear() === TODAY.getFullYear();
      })
      .reduce((s, i) => s + i.amount, 0);

    const delays = paidInvoices.map((i) => daysBetween(new Date(i.paidDate || i.dueDate), new Date(i.dueDate)));
    const avgDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;

    return { outstanding, overdue, dueThisWeek, paidThisMonth, avgDelay };
  }, [invoices]);

  const attentionInvoices = useMemo(
    () => invoices.filter(needsAttention).sort((a, b) => attentionRank(a) - attentionRank(b) || remaining(b) - remaining(a)),
    [invoices]
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
        const haystack = `${inv.number} ${inv.client} ${inv.project} ${inv.owner}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, overdueOnly, statusFilter, clientFilter, dateRange, search]);

  const markPaid = (inv: Invoice) => {
    setInvoices((prev) =>
      prev.map((i) =>
        i.id === inv.id
          ? { ...i, status: "paid", amountPaid: i.amount, paidDate: TODAY.toISOString().slice(0, 10), paymentMethod: i.paymentMethod || "Stripe", stripeStatus: "Paid" }
          : i
      )
    );
    toast({ title: "Payment recorded", description: `${inv.number} · ${inv.client} — ${formatMoney(inv.amount)}` });
  };

  const sendReminder = (inv: Invoice) => {
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, lastReminder: "just now" } : i)));
    toast({ title: "Reminder sent", description: `A payment reminder was emailed to ${inv.client}.` });
  };

  const sendInvoice = (inv: Invoice) => {
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status: "sent", stripeStatus: "Awaiting payment" } : i)));
    toast({ title: "Invoice sent", description: `${inv.number} was sent to ${inv.client}.` });
  };

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setClientFilter("all");
    setDateRange("all");
    setOverdueOnly(false);
  };

  const filtersActive = search || statusFilter !== "all" || clientFilter !== "all" || dateRange !== "all" || overdueOnly;

  return (
    <div className="w-full min-w-0 space-y-12">
      <PageHeader
        title="Invoices"
        subtitle="Your finance cockpit — track every invoice from draft to paid, and act before things slip."
        actions={
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-2 h-4 w-4" /> New Invoice
          </Button>
        }
      />

      {/* 1. Summary cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="Outstanding Balance"
          value={formatMoney(metrics.outstanding)}
          trend={{ value: `${invoices.filter((i) => ["sent", "viewed", "partial", "overdue"].includes(i.status)).length}`, label: "open invoices", positive: false }}
          className="bg-primary text-primary-foreground border-primary"
          valueClassName="text-primary-foreground"
          icon={<Wallet className="h-5 w-5 text-primary-foreground/50" />}
        />
        <MetricCard
          title="Overdue Amount"
          value={formatMoney(metrics.overdue)}
          trend={{ value: "Action required", label: "", positive: false }}
          valueClassName="text-soft-red"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <MetricCard
          title="Due This Week"
          value={formatMoney(metrics.dueThisWeek)}
          trend={{ value: `${invoices.filter((i) => isDueSoon(i, 7)).length}`, label: "invoices", positive: undefined }}
          valueClassName="text-warm-yellow"
          icon={<CalendarClock className="h-5 w-5" />}
        />
        <MetricCard
          title="Paid This Month"
          value={formatMoney(metrics.paidThisMonth)}
          trend={{ value: "+24%", label: "vs last month", positive: true }}
          valueClassName="text-soft-green"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <MetricCard
          title="Avg. Payment Delay"
          value={`${metrics.avgDelay} ${Math.abs(metrics.avgDelay) === 1 ? "day" : "days"}`}
          trend={{ value: metrics.avgDelay <= 0 ? "Paid early" : "after due date", label: "", positive: metrics.avgDelay <= 3 }}
          icon={<Clock className="h-5 w-5" />}
        />
      </div>

      {/* 2. Needs Attention */}
      <section>
        <div className="mb-5 flex items-baseline justify-between">
          <div>
            <h3 className="text-xl font-bold tracking-tight text-foreground">Needs Attention</h3>
            <p className="mt-1 text-sm text-muted-foreground">Overdue, due soon, and drafts waiting to be sent.</p>
          </div>
          <span className="text-xs font-medium text-muted-foreground">{attentionInvoices.length} to review</span>
        </div>

        {attentionInvoices.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {attentionInvoices.map((inv) => (
              <PriorityInvoiceCard
                key={inv.id}
                invoice={inv}
                onView={() => setSelectedInvoice(inv)}
                onMarkPaid={() => markPaid(inv)}
                onSendReminder={() => sendReminder(inv)}
                onSend={() => sendInvoice(inv)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card py-16 text-center">
            <CheckCircle2 className="mb-3 h-8 w-8 text-soft-green" />
            <p className="font-medium text-foreground">All clear</p>
            <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
          </div>
        )}
      </section>

      {/* 3. Invoice Lifecycle */}
      <section>
        <div className="mb-5">
          <h3 className="text-xl font-bold tracking-tight text-foreground">Invoice Lifecycle</h3>
          <p className="mt-1 text-sm text-muted-foreground">Every invoice by stage, from draft to paid.</p>
        </div>
        <InvoiceLifecycleBoard invoices={invoices} onCardClick={(inv) => setSelectedInvoice(inv)} />
      </section>

      {/* 4. All Invoices */}
      <section>
        <div className="mb-5 flex items-baseline justify-between">
          <h3 className="text-xl font-bold tracking-tight text-foreground">All Invoices</h3>
          <span className="text-xs font-medium text-muted-foreground">{filteredInvoices.length} of {invoices.length}</span>
        </div>

        {/* filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search invoice, client, project, owner…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as InvoiceStatus | "all")}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(INVOICE_STATUS) as InvoiceStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{INVOICE_STATUS[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="quarter">Last 90 days</SelectItem>
              <SelectItem value="overdue-window">Last 30 days</SelectItem>
            </SelectContent>
          </Select>

          <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <Switch checked={overdueOnly} onCheckedChange={setOverdueOnly} />
            <span className="text-muted-foreground">Overdue only</span>
          </label>

          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
              Clear
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <DataTable
            data={filteredInvoices}
            onRowClick={(inv) => setSelectedInvoice(inv)}
            columns={[
              { header: "Invoice", accessorKey: "number", className: "font-mono text-xs whitespace-nowrap" },
              { header: "Client", accessorKey: "client", className: "font-medium whitespace-nowrap" },
              { header: "Project", cell: (i: Invoice) => <span className="whitespace-nowrap text-muted-foreground">{i.project}</span> },
              { header: "Amount", cell: (i: Invoice) => <span className="whitespace-nowrap font-semibold">{formatMoney(i.amount)}</span> },
              { header: "Status", cell: (i: Invoice) => <StatusBadge status={INVOICE_STATUS[i.status].label} variant={INVOICE_STATUS[i.status].variant} /> },
              { header: "Issue Date", cell: (i: Invoice) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(i.issueDate)}</span> },
              { header: "Due Date", cell: (i: Invoice) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(i.dueDate)}</span> },
              { header: "Paid Date", cell: (i: Invoice) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(i.paidDate)}</span> },
              { header: "Method", cell: (i: Invoice) => <span className="whitespace-nowrap text-muted-foreground">{i.paymentMethod ?? "—"}</span> },
              { header: "Owner", cell: (i: Invoice) => <span className="whitespace-nowrap text-muted-foreground">{i.owner}</span> },
              {
                header: "",
                className: "w-px",
                cell: (i: Invoice) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button onClick={(e) => e.stopPropagation()} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => setSelectedInvoice(i)}>
                        <Eye className="mr-2 h-4 w-4" /> View
                      </DropdownMenuItem>
                      {i.status !== "paid" && (
                        <DropdownMenuItem onClick={() => markPaid(i)}>
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Mark Paid
                        </DropdownMenuItem>
                      )}
                      {i.status !== "paid" && i.status !== "draft" && (
                        <DropdownMenuItem onClick={() => sendReminder(i)}>
                          <Bell className="mr-2 h-4 w-4" /> Send Reminder
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem>
                        <Download className="mr-2 h-4 w-4" /> Download PDF
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ),
              },
            ]}
          />
        </div>
      </section>

      <EntityDrawer
        open={!!selectedInvoice}
        onOpenChange={(open) => !open && setSelectedInvoice(null)}
        title={selectedInvoice?.number}
        description="Invoice Details"
        headerActions={
          <>
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" /> PDF
            </Button>
            {selectedInvoice && <StatusBadge status={INVOICE_STATUS[selectedInvoice.status].label} variant={INVOICE_STATUS[selectedInvoice.status].variant} />}
          </>
        }
      >
        {selectedInvoice && (
          <div className="space-y-8">
            <div className="flex justify-between rounded-xl border border-border bg-card p-6 shadow-sm">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Billed To</h4>
                <p className="text-lg font-medium text-foreground">{selectedInvoice.client}</p>
                <p className="mt-1 text-sm text-muted-foreground">{selectedInvoice.project}</p>
              </div>
              <div className="text-right">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {selectedInvoice.status === "partial" ? "Balance Due" : "Amount"}
                </h4>
                <p className="font-serif text-4xl font-bold text-primary">{formatMoney(remaining(selectedInvoice))}</p>
                {selectedInvoice.amountPaid > 0 && selectedInvoice.status !== "paid" && (
                  <p className="mt-1 text-xs text-muted-foreground">{formatMoney(selectedInvoice.amountPaid)} already paid</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <DetailBox label="Issue Date" value={formatDate(selectedInvoice.issueDate)} />
              <DetailBox label="Due Date" value={formatDate(selectedInvoice.dueDate)} />
              <DetailBox label="Owner" value={selectedInvoice.owner} />
              <DetailBox label="Stripe Status" value={selectedInvoice.stripeStatus} />
              {selectedInvoice.paymentMethod && <DetailBox label="Payment Method" value={selectedInvoice.paymentMethod} />}
              {selectedInvoice.paidDate && <DetailBox label="Paid Date" value={formatDate(selectedInvoice.paidDate)} />}
            </div>

            <div>
              <h4 className="mb-4 font-semibold text-foreground">Line Items</h4>
              <div className="space-y-3 rounded-xl border border-border bg-card p-6">
                {selectedInvoice.lineItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-border/50 py-2 text-sm last:border-0">
                    <span className="font-medium text-foreground">{item.description}</span>
                    <span className="text-muted-foreground">{formatMoney(item.amount)}</span>
                  </div>
                ))}
                <div className="mt-2 flex justify-between pt-4 text-lg font-bold text-foreground">
                  <span>Total</span>
                  <span>{formatMoney(selectedInvoice.amount)}</span>
                </div>
              </div>
            </div>

            <div className="pt-2">
              {selectedInvoice.status === "paid" ? (
                <div className="flex items-center justify-center rounded-xl border border-soft-green/20 bg-soft-green/10 p-4 font-medium text-soft-green">
                  Payment Completed
                </div>
              ) : selectedInvoice.status === "draft" ? (
                <Button
                  className="h-12 w-full bg-primary text-md text-primary-foreground hover:bg-primary/90"
                  onClick={() => { sendInvoice(selectedInvoice); setSelectedInvoice(null); }}
                >
                  Send Invoice
                </Button>
              ) : (
                <div className="flex gap-4">
                  <Button
                    className="h-12 flex-1 bg-primary text-md text-primary-foreground hover:bg-primary/90"
                    onClick={() => { markPaid(selectedInvoice); setSelectedInvoice(null); }}
                  >
                    Record Payment
                  </Button>
                  <Button variant="outline" className="h-12 flex-1 text-md" onClick={() => sendReminder(selectedInvoice)}>
                    Send Reminder
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </EntityDrawer>
    </div>
  );
}

function DetailBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
