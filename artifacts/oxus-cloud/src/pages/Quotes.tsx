import React, { useState } from "react";
import { quotesData } from "@/data/mock";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

const STATUS_OPTIONS = ["all", "draft", "sent", "accepted", "declined"] as const;

export function Quotes() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedQuote, setSelectedQuote] = useState<any>(null);

  const filteredQuotes = quotesData
    .filter(q =>
      q.client.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.project.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.number.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .filter(q => statusFilter === "all" || q.status === statusFilter)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalValue = quotesData.reduce((sum, q) => sum + q.amount, 0);
  const acceptedValue = quotesData.filter(q => q.status === 'accepted').reduce((sum, q) => sum + q.amount, 0);
  const pendingCount = quotesData.filter(q => q.status === 'sent').length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Quotes</h2>
          <p className="text-muted-foreground text-sm">Manage and track your proposals.</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-primary text-primary-foreground border-primary-border">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium opacity-80">Total Pipeline Value</h3>
            <p className="text-3xl font-bold mt-2">${totalValue.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-muted-foreground">Accepted (Won)</h3>
            <p className="text-3xl font-bold mt-2 text-chart-2">${acceptedValue.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-muted-foreground">Pending Quotes</h3>
            <p className="text-3xl font-bold mt-2">{pendingCount}</p>
          </CardContent>
        </Card>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex flex-wrap gap-3 justify-between items-center">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search quotes..." 
              className="pl-9 bg-background"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 bg-background">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status} className="capitalize">
                  {status === "all" ? "All statuses" : status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quote Number</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredQuotes.map((quote) => (
              <TableRow key={quote.id} onClick={() => setSelectedQuote(quote)} className="cursor-pointer hover:bg-muted/50">
                <TableCell className="font-medium">{quote.number}</TableCell>
                <TableCell>{quote.client}</TableCell>
                <TableCell>{quote.project}</TableCell>
                <TableCell>${quote.amount.toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={
                    quote.status === 'accepted' ? 'default' : 
                    quote.status === 'sent' ? 'secondary' : 
                    quote.status === 'declined' ? 'destructive' : 'outline'
                  } className={quote.status === 'accepted' ? 'bg-chart-2 hover:bg-chart-2/80 text-white' : ''}>
                    {quote.status}
                  </Badge>
                </TableCell>
                <TableCell>{quote.date}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!selectedQuote} onOpenChange={() => setSelectedQuote(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selectedQuote?.number}</SheetTitle>
            <SheetDescription>{selectedQuote?.project} for {selectedQuote?.client}</SheetDescription>
          </SheetHeader>
          {selectedQuote && (
            <div className="mt-6 space-y-4">
              <div className="p-4 bg-muted rounded-lg flex justify-between items-center">
                <span className="font-medium">Total Amount</span>
                <span className="text-xl font-bold">${selectedQuote.amount.toLocaleString()}</span>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
