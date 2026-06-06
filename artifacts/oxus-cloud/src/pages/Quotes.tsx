import React, { useState } from "react";
import { quotesData } from "@/data/mock";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { EntityDrawer } from "@/components/EntityDrawer";
import { AvatarStack } from "@/components/AvatarStack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, FileText, Send, XCircle, CheckCircle2, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

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

  const pendingValue = quotesData.filter(q => q.status === 'sent').reduce((sum, q) => sum + q.amount, 0);
  const acceptedValue = quotesData.filter(q => q.status === 'accepted').reduce((sum, q) => sum + q.amount, 0);
  const declinedValue = quotesData.filter(q => q.status === 'declined').reduce((sum, q) => sum + q.amount, 0);
  
  const resolvedCount = quotesData.filter(q => q.status === 'accepted' || q.status === 'declined').length;
  const acceptedCount = quotesData.filter(q => q.status === 'accepted').length;
  const conversionRate = resolvedCount > 0 ? Math.round((acceptedCount / resolvedCount) * 100) : 0;

  const columns = [
    {
      header: "Quote",
      cell: (item: any) => (
        <div>
          <div className="font-medium text-foreground">{item.number}</div>
          <div className="text-xs text-muted-foreground">{item.date}</div>
        </div>
      )
    },
    {
      header: "Client & Project",
      cell: (item: any) => (
        <div className="flex items-center gap-3">
          <AvatarStack urls={[`https://ui-avatars.com/api/?name=${encodeURIComponent(item.client)}&background=random`]} size="md" />
          <div>
            <div className="font-medium text-foreground">{item.client}</div>
            <div className="text-xs text-muted-foreground">{item.project}</div>
          </div>
        </div>
      )
    },
    {
      header: "Amount",
      cell: (item: any) => (
        <div className="font-medium font-sans">
          ${item.amount.toLocaleString()}
        </div>
      )
    },
    {
      header: "Owner",
      cell: (item: any) => (
        <div className="flex items-center gap-2">
          <AvatarStack urls={[`https://ui-avatars.com/api/?name=${encodeURIComponent(item.owner)}&background=random`]} size="sm" />
          <span className="text-sm">{item.owner}</span>
        </div>
      )
    },
    {
      header: "Status",
      cell: (item: any) => (
        <StatusBadge status={item.status} />
      )
    },
    {
      header: "",
      className: "text-right",
      cell: (item: any) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>View Details</DropdownMenuItem>
              <DropdownMenuItem>Download PDF</DropdownMenuItem>
              <DropdownMenuItem>Send Reminder</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader 
        title="Quotes & Proposals" 
        subtitle="Manage deals, track conversions, and close contracts."
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Quotes" }]}
        actions={
          <Button className="bg-magenta hover:bg-magenta/90 text-white shadow-soft">
            <Plus className="w-4 h-4 mr-2" />
            New Quote
          </Button>
        }
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard 
          title="Conversion Rate" 
          value={`${conversionRate}%`} 
          icon={<CheckCircle2 className="w-5 h-5 text-soft-green" />}
          trend={{ value: "+5%", label: "vs last month", positive: true }}
          className="border-soft-green/20"
        />
        <MetricCard 
          title="Pending Value" 
          value={`$${pendingValue.toLocaleString()}`} 
          icon={<Send className="w-5 h-5 text-warm-yellow" />}
          trend={{ value: "12 active", label: "quotes out" }}
        />
        <MetricCard 
          title="Accepted Value" 
          value={`$${acceptedValue.toLocaleString()}`} 
          icon={<CheckCircle2 className="w-5 h-5 text-soft-green" />}
          trend={{ value: "+$12k", label: "vs last month", positive: true }}
        />
        <MetricCard 
          title="Declined Value" 
          value={`$${declinedValue.toLocaleString()}`} 
          icon={<XCircle className="w-5 h-5 text-soft-red" />}
          trend={{ value: "-$4k", label: "vs last month", positive: true }}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 rounded-xl border border-border shadow-soft">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search quotes by client, project..." 
            className="pl-9 bg-background/50 border-border focus-visible:ring-magenta"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px] bg-background/50">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status} className="capitalize">
                  {status === "all" ? "All Statuses" : status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable 
        data={filteredQuotes} 
        columns={columns} 
        onRowClick={(quote) => setSelectedQuote(quote)} 
      />

      <EntityDrawer 
        open={!!selectedQuote} 
        onOpenChange={(open) => !open && setSelectedQuote(null)}
        title={selectedQuote?.number}
        description={`Created on ${selectedQuote?.date}`}
        headerActions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <FileText className="w-4 h-4 mr-2" />
              PDF
            </Button>
            <Button size="sm" className="bg-foreground text-background">
              Edit
            </Button>
          </div>
        }
      >
        {selectedQuote && (
          <div className="space-y-8 animate-in fade-in duration-300">
            {/* Status Banner */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border/50">
              <div className="flex items-center gap-3">
                <StatusBadge status={selectedQuote.status} />
                <span className="text-sm text-muted-foreground">
                  Owner: <span className="font-medium text-foreground">{selectedQuote.owner}</span>
                </span>
              </div>
              <div className="text-2xl font-bold font-sans">
                ${selectedQuote.amount.toLocaleString()}
              </div>
            </div>

            {/* Client Info */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Client Details</h3>
              <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card shadow-soft">
                <AvatarStack urls={[`https://ui-avatars.com/api/?name=${encodeURIComponent(selectedQuote.client)}&background=random`]} size="lg" />
                <div>
                  <h4 className="font-semibold text-lg">{selectedQuote.client}</h4>
                  <p className="text-sm text-muted-foreground">{selectedQuote.project}</p>
                </div>
              </div>
            </div>

            {/* Conversion Probability */}
            {(selectedQuote.status === 'draft' || selectedQuote.status === 'sent') && (
              <div>
                <div className="flex justify-between items-end mb-2">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Conversion Probability</h3>
                  <span className="text-sm font-medium">{selectedQuote.conversion}%</span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-primary/15">
                  <div
                    className={`h-full rounded-full transition-all ${
                      selectedQuote.conversion >= 80 ? "bg-soft-green" :
                      selectedQuote.conversion >= 50 ? "bg-warm-yellow" : "bg-soft-red"
                    }`}
                    style={{ width: `${selectedQuote.conversion}%` }}
                  />
                </div>
              </div>
            )}

            {/* Timeline/Activity Mock */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Activity</h3>
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-border/50">
                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-background bg-magenta text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10"></div>
                  <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] bg-card p-3 rounded-xl border border-border shadow-soft">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-sm font-semibold">Quote Created</h4>
                      <span className="text-xs text-muted-foreground">{selectedQuote.date}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Drafted by {selectedQuote.owner}</p>
                  </div>
                </div>
                {selectedQuote.status !== 'draft' && (
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-background bg-warm-yellow text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10"></div>
                    <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] bg-card p-3 rounded-xl border border-border shadow-soft">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-sm font-semibold">Sent to Client</h4>
                        <span className="text-xs text-muted-foreground">1 day after creation</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Email viewed 2 times.</p>
                    </div>
                  </div>
                )}
                {selectedQuote.status === 'accepted' && (
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-background bg-soft-green text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10"></div>
                    <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] bg-card p-3 rounded-xl border border-border shadow-soft">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-sm font-semibold">Accepted</h4>
                        <span className="text-xs text-muted-foreground">Just now</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Signed by client.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </EntityDrawer>
    </div>
  );
}
