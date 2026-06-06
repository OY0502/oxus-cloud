import React, { useMemo, useState } from "react";
import { invoicesData } from "@/data/mock";
import { InvoicePaperCard } from "@/components/InvoicePaperCard";
import { DataTable } from "@/components/DataTable";
import { EntityDrawer } from "@/components/EntityDrawer";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { FileText, Plus, Download, CalendarClock, Clock, AlertTriangle, Wallet } from "lucide-react";

const TODAY = new Date("2026-06-15");

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Invoices() {
  const [invoices, setInvoices] = useState(invoicesData);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const { toast } = useToast();

  const deskInvoices = invoices.filter((inv) => inv.status !== "paid");
  const paidInvoices = invoices.filter((inv) => inv.status === "paid");

  const metrics = useMemo(() => {
    const outstanding = invoices
      .filter((i) => i.status === "pending" || i.status === "overdue")
      .reduce((sum, i) => sum + i.amount, 0);

    const overdue = invoices.filter((i) => i.status === "overdue").reduce((sum, i) => sum + i.amount, 0);

    const paidThisMonth = paidInvoices
      .filter((i) => {
        const d = new Date(i.paidDate || i.date);
        return d.getMonth() === TODAY.getMonth() && d.getFullYear() === TODAY.getFullYear();
      })
      .reduce((sum, i) => sum + i.amount, 0);

    const upcoming = invoices
      .filter((i) => (i.status === "pending" || i.status === "overdue") && new Date(i.dueDate) >= TODAY)
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

    const delays = paidInvoices.map((i) => daysBetween(new Date(i.paidDate || i.date), new Date(i.dueDate)));
    const avgDelay = delays.length ? Math.round(delays.reduce((s, d) => s + d, 0) / delays.length) : 0;

    return { outstanding, overdue, paidThisMonth, upcoming, avgDelay };
  }, [invoices, paidInvoices]);

  const markPaid = (inv: any) => {
    setInvoices((prev) =>
      prev.map((i) =>
        i.id === inv.id ? { ...i, status: "paid", paidDate: TODAY.toISOString().slice(0, 10) } : i
      )
    );
    toast({ title: "Marked as paid", description: `${inv.number} · ${inv.client} — $${inv.amount.toLocaleString()}` });
  };

  const sendReminder = (inv: any) => {
    toast({ title: "Reminder sent", description: `A payment reminder was emailed to ${inv.client}.` });
  };

  return (
    <div className="space-y-12">
      <PageHeader
        title="Invoices"
        subtitle="Everything on your desk — what's owed, what's overdue, and what's been settled."
        actions={
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-2 h-4 w-4" /> New Invoice
          </Button>
        }
      />

      {/* Summary metrics */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="Outstanding Balance"
          value={`$${metrics.outstanding.toLocaleString()}`}
          trend={{ value: `${deskInvoices.filter((i) => i.status !== "draft").length}`, label: "awaiting payment", positive: false }}
          className="bg-primary text-primary-foreground border-primary"
          valueClassName="text-primary-foreground"
          icon={<Wallet className="h-5 w-5 text-primary-foreground/50" />}
        />
        <MetricCard
          title="Paid This Month"
          value={`$${metrics.paidThisMonth.toLocaleString()}`}
          trend={{ value: "+24%", label: "vs last month", positive: true }}
          valueClassName="text-soft-green"
          icon={<FileText className="h-5 w-5" />}
        />
        <MetricCard
          title="Overdue Amount"
          value={`$${metrics.overdue.toLocaleString()}`}
          trend={{ value: "Action required", label: "", positive: false }}
          valueClassName="text-soft-red"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <MetricCard
          title="Next Invoice Due"
          value={metrics.upcoming ? formatShortDate(metrics.upcoming.dueDate) : "—"}
          trend={metrics.upcoming ? { value: metrics.upcoming.client, label: `· $${metrics.upcoming.amount.toLocaleString()}`, positive: undefined } : undefined}
          icon={<CalendarClock className="h-5 w-5" />}
        />
        <MetricCard
          title="Avg. Payment Delay"
          value={`${metrics.avgDelay} ${Math.abs(metrics.avgDelay) === 1 ? "day" : "days"}`}
          trend={{ value: metrics.avgDelay <= 0 ? "Paid early" : "After due date", label: "", positive: metrics.avgDelay <= 3 }}
          icon={<Clock className="h-5 w-5" />}
        />
      </div>

      {/* Invoice Desk */}
      <section>
        <div className="mb-6 flex items-baseline justify-between">
          <div>
            <h3 className="font-serif text-2xl font-bold text-foreground">The Desk</h3>
            <p className="mt-1 text-sm text-muted-foreground">Open invoices laid out, newest on top. Hover a sheet to act on it.</p>
          </div>
          <span className="text-xs font-medium text-muted-foreground">{deskInvoices.length} on the desk</span>
        </div>

        <div
          className="relative overflow-hidden rounded-3xl border border-border/60 p-8 sm:p-10"
          style={{
            backgroundColor: "hsl(var(--muted))",
            backgroundImage:
              "radial-gradient(circle at 20% 0%, rgba(209,232,255,0.35), transparent 45%), radial-gradient(circle at 85% 100%, rgba(253,230,138,0.18), transparent 45%), url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='d'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23d)' opacity='0.03'/%3E%3C/svg%3E\")",
          }}
        >
          {deskInvoices.length > 0 ? (
            <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
              {deskInvoices.map((inv, i) => (
                <InvoicePaperCard
                  key={inv.id}
                  invoice={inv}
                  index={i}
                  onView={() => setSelectedInvoice(inv)}
                  onMarkPaid={() => markPaid(inv)}
                  onSendReminder={() => sendReminder(inv)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="mb-3 h-8 w-8 text-muted-foreground/50" />
              <p className="font-medium text-foreground">The desk is clear</p>
              <p className="text-sm text-muted-foreground">Every invoice has been settled.</p>
            </div>
          )}
        </div>
      </section>

      {/* Payment Archive */}
      <section>
        <h3 className="mb-4 font-serif text-lg font-semibold text-muted-foreground">Payment Archive</h3>
        <DataTable
          data={paidInvoices}
          onRowClick={(inv) => setSelectedInvoice(inv)}
          columns={[
            { header: "Invoice", accessorKey: "number", className: "font-mono text-xs" },
            { header: "Client", accessorKey: "client", className: "font-medium" },
            { header: "Amount", cell: (inv: any) => <span className="font-semibold">${inv.amount.toLocaleString()}</span> },
            { header: "Due", cell: (inv: any) => <span className="text-muted-foreground">{formatShortDate(inv.dueDate)}</span> },
            { header: "Date Paid", cell: (inv: any) => formatShortDate(inv.paidDate || inv.date) },
            { header: "Status", cell: (inv: any) => <StatusBadge status={inv.status} /> },
          ]}
        />
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
            <StatusBadge status={selectedInvoice?.status || "pending"} />
          </>
        }
      >
        {selectedInvoice && (
          <div className="space-y-8">
            <div className="flex justify-between rounded-xl border border-border bg-card p-6 shadow-sm">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Billed To</h4>
                <p className="text-lg font-medium text-foreground">{selectedInvoice.client}</p>
                <p className="mt-1 text-sm text-muted-foreground">123 Business Rd.<br />San Francisco, CA</p>
              </div>
              <div className="text-right">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Amount Due</h4>
                <p className="font-serif text-4xl font-bold text-primary">${selectedInvoice.amount.toLocaleString()}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Issue Date</span>
                <span className="font-medium">{selectedInvoice.issueDate || selectedInvoice.date}</span>
              </div>
              <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {selectedInvoice.status === "paid" ? "Date Paid" : "Due Date"}
                </span>
                <span className="font-medium">{selectedInvoice.status === "paid" ? selectedInvoice.paidDate || selectedInvoice.date : selectedInvoice.dueDate}</span>
              </div>
            </div>

            <div>
              <h4 className="mb-4 font-semibold text-foreground">Line Items</h4>
              <div className="space-y-3 rounded-xl border border-border bg-card p-6">
                {(selectedInvoice.lineItems || [{ description: "Consulting Services", amount: selectedInvoice.amount }]).map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between border-b border-border/50 py-2 text-sm last:border-0">
                    <span className="font-medium text-foreground">{item.description}</span>
                    <span className="text-muted-foreground">${item.amount.toLocaleString()}</span>
                  </div>
                ))}
                <div className="mt-2 flex justify-between pt-4 text-lg font-bold text-foreground">
                  <span>Total</span>
                  <span>${selectedInvoice.amount.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="pt-6">
              {selectedInvoice.status !== "paid" ? (
                <div className="flex gap-4">
                  <Button
                    className="h-12 flex-1 bg-primary text-md text-primary-foreground hover:bg-primary/90"
                    onClick={() => {
                      markPaid(selectedInvoice);
                      setSelectedInvoice(null);
                    }}
                  >
                    Record Payment
                  </Button>
                  <Button variant="outline" className="h-12 flex-1 text-md" onClick={() => sendReminder(selectedInvoice)}>
                    Send Reminder
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-center rounded-xl border border-soft-green/20 bg-soft-green/10 p-4 font-medium text-soft-green">
                  Payment Completed
                </div>
              )}
            </div>
          </div>
        )}
      </EntityDrawer>
    </div>
  );
}
