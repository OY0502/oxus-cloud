import React, { useState } from "react";
import { invoicesData } from "@/data/mock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { FileText, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Invoices() {
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  const pendingInvoices = invoicesData.filter(inv => inv.status !== 'paid');
  const paidInvoices = invoicesData.filter(inv => inv.status === 'paid');

  const totalOutstanding = pendingInvoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalPaid = paidInvoices.reduce((sum, inv) => sum + inv.amount, 0);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Invoices</h2>
          <p className="text-muted-foreground text-sm">Manage billing and payments.</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-primary text-primary-foreground border-primary-border relative overflow-hidden">
          <div className="absolute right-0 top-0 opacity-10 scale-150 translate-x-4 -translate-y-4">
            <FileText size={120} />
          </div>
          <CardContent className="p-6 relative z-10">
            <h3 className="text-sm font-medium opacity-80">Outstanding Balance</h3>
            <p className="text-4xl font-bold mt-2">${totalOutstanding.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-muted-foreground">Paid This Month</h3>
            <p className="text-3xl font-bold mt-2 text-chart-2">${totalPaid.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-muted-foreground">Overdue</h3>
            <p className="text-3xl font-bold mt-2 text-destructive">
              ${invoicesData.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="text-lg font-bold mb-4">Pending Attention</h3>
        <div className="grid gap-6 md:grid-cols-3">
          {pendingInvoices.map((inv) => (
            <Card 
              key={inv.id} 
              className="cursor-pointer hover-elevate transition-all group overflow-hidden relative border-t-4 data-[status=overdue]:border-t-destructive data-[status=pending]:border-t-chart-5"
              data-status={inv.status}
              onClick={() => setSelectedInvoice(inv)}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/5 z-0" />
              <CardContent className="p-6 relative z-10 flex flex-col h-full">
                <div className="flex justify-between items-start mb-4">
                  <Badge variant={inv.status === 'overdue' ? 'destructive' : 'outline'} className={inv.status === 'pending' ? 'bg-chart-5/10 text-chart-5 border-chart-5/20' : ''}>
                    {inv.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-medium">{inv.number}</span>
                </div>
                <div className="flex-1">
                  <h4 className="text-2xl font-serif font-bold">${inv.amount.toLocaleString()}</h4>
                  <p className="text-sm font-medium mt-1 text-muted-foreground">{inv.client}</p>
                </div>
                <div className="mt-6 pt-4 border-t border-border flex justify-between items-center text-xs text-muted-foreground">
                  <span>Due: {inv.dueDate}</span>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center text-primary font-medium">
                    View <ArrowUpRight className="w-3 h-3 ml-1" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-bold mb-4">Completed Payments</h3>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paidInvoices.map((inv) => (
                <TableRow key={inv.id} onClick={() => setSelectedInvoice(inv)} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-medium">{inv.number}</TableCell>
                  <TableCell>{inv.client}</TableCell>
                  <TableCell>${inv.amount.toLocaleString()}</TableCell>
                  <TableCell>{inv.date}</TableCell>
                  <TableCell>
                    <div className="flex items-center text-chart-2 text-sm font-medium">
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Paid
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Sheet open={!!selectedInvoice} onOpenChange={() => setSelectedInvoice(null)}>
        <SheetContent className="sm:max-w-[600px] w-[90vw]">
          <SheetHeader className="pb-6 border-b border-border">
            <div className="flex justify-between items-start">
              <div>
                <SheetTitle className="text-2xl font-serif">{selectedInvoice?.number}</SheetTitle>
                <SheetDescription>Invoice Details</SheetDescription>
              </div>
              <Badge variant={
                selectedInvoice?.status === 'paid' ? 'default' : 
                selectedInvoice?.status === 'overdue' ? 'destructive' : 'outline'
              } className={selectedInvoice?.status === 'paid' ? 'bg-chart-2 text-white' : ''}>
                {selectedInvoice?.status}
              </Badge>
            </div>
          </SheetHeader>
          {selectedInvoice && (
            <div className="mt-6 space-y-8">
              <div className="flex justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Billed To</h4>
                  <p className="font-medium text-lg">{selectedInvoice.client}</p>
                </div>
                <div className="text-right">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Amount Due</h4>
                  <p className="font-bold text-3xl text-primary">${selectedInvoice.amount.toLocaleString()}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Issue Date</span>
                  <span className="font-medium">{selectedInvoice.date}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Due Date</span>
                  <span className="font-medium">{selectedInvoice.dueDate}</span>
                </div>
              </div>

              {/* Mock Line Items */}
              <div>
                <h4 className="font-semibold mb-3 border-b border-border pb-2">Line Items</h4>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">Web Development Services</span>
                    <span>${(selectedInvoice.amount * 0.8).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">UI/UX Design</span>
                    <span>${(selectedInvoice.amount * 0.2).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-3 border-t border-border mt-3 text-lg">
                    <span>Total</span>
                    <span>${selectedInvoice.amount.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="pt-8">
                {selectedInvoice.status !== 'paid' && (
                  <Button className="w-full h-12 text-lg">Mark as Paid</Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
