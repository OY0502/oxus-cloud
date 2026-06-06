import React, { useState } from "react";
import { invoicesData } from "@/data/mock";
import { InvoicePaperCard } from "@/components/InvoicePaperCard";
import { DataTable } from "@/components/DataTable";
import { EntityDrawer } from "@/components/EntityDrawer";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { FileText, ArrowUpRight, Plus, Download } from "lucide-react";

export function Invoices() {
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  const pendingInvoices = invoicesData.filter(inv => inv.status !== 'paid');
  const paidInvoices = invoicesData.filter(inv => inv.status === 'paid');

  const totalOutstanding = pendingInvoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalPaid = paidInvoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalOverdue = pendingInvoices.filter(i => i.status === 'overdue').reduce((sum, inv) => sum + inv.amount, 0);

  return (
    <div className="space-y-12">
      <PageHeader 
        title="Invoices"
        subtitle="Manage billing, payments, and outstanding balances."
        actions={
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> New Invoice
          </Button>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <MetricCard 
          title="Outstanding Balance"
          value={`$${totalOutstanding.toLocaleString()}`}
          trend={{ value: `${pendingInvoices.length}`, label: "invoices pending", positive: false }}
          className="bg-primary text-primary-foreground border-primary-border"
          valueClassName="text-primary-foreground"
          icon={<FileText className="w-5 h-5 text-primary-foreground/50" />}
        />
        <MetricCard 
          title="Paid This Month"
          value={`$${totalPaid.toLocaleString()}`}
          trend={{ value: "+24%", label: "vs last month", positive: true }}
          valueClassName="text-soft-green"
        />
        <MetricCard 
          title="Overdue"
          value={`$${totalOverdue.toLocaleString()}`}
          trend={{ value: "Action required", label: "", positive: false }}
          valueClassName="text-soft-red"
        />
      </div>

      <div>
        <h3 className="text-xl font-bold font-serif mb-6 text-foreground">Desk View</h3>
        <div className="grid gap-8 md:grid-cols-3 p-8 bg-muted/20 rounded-2xl border border-border/50 relative overflow-hidden">
          {/* Subtle desk texture / shading */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-muted/30 z-0 pointer-events-none" />
          
          {pendingInvoices.map((inv) => (
            <InvoicePaperCard 
              key={inv.id} 
              invoice={inv} 
              onClick={() => setSelectedInvoice(inv)} 
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold font-serif mb-6 text-foreground">Payment Archive</h3>
        <DataTable 
          data={paidInvoices}
          onRowClick={(inv) => setSelectedInvoice(inv)}
          columns={[
            {
              header: "Invoice",
              accessorKey: "number",
              className: "font-mono text-xs",
            },
            {
              header: "Client",
              accessorKey: "client",
              className: "font-medium",
            },
            {
              header: "Amount",
              cell: (inv) => <span className="font-semibold">${inv.amount.toLocaleString()}</span>,
            },
            {
              header: "Date Paid",
              accessorKey: "date",
            },
            {
              header: "Status",
              cell: (inv) => <StatusBadge status={inv.status} />
            }
          ]}
        />
      </div>

      <EntityDrawer 
        open={!!selectedInvoice} 
        onOpenChange={(open) => !open && setSelectedInvoice(null)}
        title={selectedInvoice?.number}
        description="Invoice Details"
        headerActions={
          <>
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" /> PDF
            </Button>
            <StatusBadge status={selectedInvoice?.status || 'pending'} />
          </>
        }
      >
        {selectedInvoice && (
          <div className="space-y-8">
            <div className="flex justify-between p-6 bg-card border border-border rounded-xl shadow-sm">
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Billed To</h4>
                <p className="font-medium text-lg text-foreground">{selectedInvoice.client}</p>
                <p className="text-sm text-muted-foreground mt-1">123 Business Rd.<br/>San Francisco, CA</p>
              </div>
              <div className="text-right">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Amount Due</h4>
                <p className="font-bold text-4xl text-primary font-serif">${selectedInvoice.amount.toLocaleString()}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
                <span className="text-xs text-muted-foreground block mb-1 uppercase tracking-wider font-semibold">Issue Date</span>
                <span className="font-medium">{selectedInvoice.date}</span>
              </div>
              <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
                <span className="text-xs text-muted-foreground block mb-1 uppercase tracking-wider font-semibold">Due Date</span>
                <span className="font-medium">{selectedInvoice.dueDate}</span>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-4 text-foreground">Line Items</h4>
              <div className="space-y-3 bg-card border border-border rounded-xl p-6">
                {(selectedInvoice.lineItems || [
                  { description: "Consulting Services", amount: selectedInvoice.amount }
                ]).map((item: any, i: number) => (
                  <div key={i} className="flex justify-between items-center py-2 border-b border-border/50 last:border-0 text-sm">
                    <span className="font-medium text-foreground">{item.description}</span>
                    <span className="text-muted-foreground">${item.amount.toLocaleString()}</span>
                  </div>
                ))}
                
                <div className="flex justify-between font-bold pt-4 mt-2 text-lg text-foreground">
                  <span>Total</span>
                  <span>${selectedInvoice.amount.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="pt-6">
              {selectedInvoice.status !== 'paid' ? (
                <div className="flex gap-4">
                  <Button className="flex-1 h-12 text-md bg-primary text-primary-foreground hover:bg-primary/90">
                    Record Payment
                  </Button>
                  <Button variant="outline" className="flex-1 h-12 text-md">
                    Send Reminder
                  </Button>
                </div>
              ) : (
                <div className="p-4 bg-soft-green/10 text-soft-green border border-soft-green/20 rounded-xl flex items-center justify-center font-medium">
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
