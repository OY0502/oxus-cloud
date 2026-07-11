import React, { useState } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { AvatarStack } from "@/components/AvatarStack";
import { QuoteDrawer } from "@/components/QuoteDrawer";
import { ConvertQuoteDialog } from "@/components/ConvertQuoteDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, FileText, Send, Trophy } from "lucide-react";
import { useQuotes, useUpdateQuoteStage } from "@/hooks/api";
import { TableSkeleton, CardGridSkeleton, EmptyState, ErrorState } from "@/components/states/QueryStates";
import { formatEUR } from "@/lib/currency";
import { profileAvatarUrl, profileDisplayName } from "@/lib/profiles";

const STAGE_OPTIONS = ["all", "new-lead", "scoping", "proposal", "won", "archived"] as const;
const STAGE_LABELS: Record<string, string> = {
  "new-lead": "New Lead",
  scoping: "Scoping",
  proposal: "Proposal",
  won: "Won",
  archived: "Archived",
};

export function Quotes() {
  const [, navigate] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [selected, setSelected] = useState<any>(null);
  const [convertQuote, setConvertQuote] = useState<any>(null);

  const { data: quotes = [], isLoading, isError, error, refetch } = useQuotes();
  const updateStage = useUpdateQuoteStage();

  const filtered = quotes
    .filter((q) => {
      const hay = `${q.number ?? ""} ${q.organization?.name ?? q.company} ${q.point_of_contact?.name ?? ""} ${q.project_type ?? ""}`.toLowerCase();
      return hay.includes(searchTerm.toLowerCase());
    })
    .filter((q) => stageFilter === "all" || q.stage === stageFilter);

  const proposalValue = quotes.filter((q) => q.stage === "proposal").reduce((s, q) => s + q.budget, 0);
  const wonValue = quotes.filter((q) => q.stage === "won").reduce((s, q) => s + q.budget, 0);
  const openCount = quotes.filter((q) => ["new-lead", "scoping", "proposal"].includes(q.stage)).length;
  const resolved = quotes.filter((q) => q.stage === "won" || q.stage === "archived").length;
  const conversionRate = resolved > 0 ? Math.round((quotes.filter((q) => q.stage === "won").length / resolved) * 100) : 0;

  const columns = [
    {
      id: "quote",
      header: "Quote",
      cell: (item: any) => (
        <div>
          <div className="font-medium text-foreground">{item.number || item.company}</div>
          <div className="text-xs text-muted-foreground">{item.project_type ?? "—"}</div>
        </div>
      ),
    },
    {
      id: "org_contact",
      header: "Organization & Contact",
      cell: (item: any) => (
        <div className="flex items-center gap-3">
          <AvatarStack urls={[`https://ui-avatars.com/api/?name=${encodeURIComponent(item.organization?.name ?? item.company)}&background=random`]} size="md" />
          <div>
            <div className="font-medium text-foreground">{item.organization?.name ?? item.company}</div>
            <div className="text-xs text-muted-foreground">{item.point_of_contact?.name ?? item.contact_name ?? "—"}</div>
          </div>
        </div>
      ),
    },
    { id: "budget", header: "Budget", cell: (item: any) => <div className="font-medium">{formatEUR(item.budget)}</div> },
    {
      id: "assigned",
      header: "Assigned to",
      cell: (item: any) =>
        item.assigned_user ? (
          <div className="flex items-center gap-2">
            <AvatarStack urls={[profileAvatarUrl(item.assigned_user)]} size="sm" />
            <span className="text-sm">{profileDisplayName(item.assigned_user)}</span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Unassigned</span>
        ),
    },
    { id: "stage", header: "Stage", cell: (item: any) => <StatusBadge status={STAGE_LABELS[item.stage] ?? item.stage} /> },
  ];

  const handleMarkWon = (quote: any) => {
    updateStage.mutate({ id: quote.id, stage: "won" });
    setSelected(null);
    setConvertQuote(quote);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Quotes"
        subtitle="Every opportunity in one place. Pipeline view available too."
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Quotes" }]}
        actions={
          <Button className="bg-magenta hover:bg-magenta/90 text-white shadow-soft" onClick={() => navigate("/quotes/new")}>
            <Plus className="w-4 h-4 mr-2" />
            New Quote
          </Button>
        }
      />

      {isLoading ? (
        <CardGridSkeleton />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Win Rate" value={`${conversionRate}%`} icon={<Trophy className="w-5 h-5 text-soft-green" />} className="border-soft-green/20" />
          <MetricCard title="Open Quotes" value={openCount} icon={<Send className="w-5 h-5 text-warm-yellow" />} />
          <MetricCard title="Proposal Value" value={formatEUR(proposalValue)} icon={<FileText className="w-5 h-5 text-logo-blue" />} />
          <MetricCard title="Won Value" value={formatEUR(wonValue)} icon={<Trophy className="w-5 h-5 text-soft-green" />} />
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 rounded-xl border border-card-border shadow-soft">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search quotes by org, contact…" className="pl-9 bg-background/50 border-border focus-visible:ring-magenta" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-full sm:w-[180px] bg-background/50"><SelectValue placeholder="Filter by stage" /></SelectTrigger>
            <SelectContent>
              {STAGE_OPTIONS.map((stage) => (
                <SelectItem key={stage} value={stage}>{stage === "all" ? "All Stages" : STAGE_LABELS[stage] ?? stage}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton columns={5} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : quotes.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="No quotes yet"
          description="Create your first quote to start tracking conversions and closing deals."
          action={<Button className="bg-magenta hover:bg-magenta/90 text-white" onClick={() => navigate("/quotes/new")}><Plus className="w-4 h-4 mr-2" />New Quote</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search />} title="No matches" description="No quotes match your current filters." />
      ) : (
        <DataTable tableId="quotes" data={filtered} columns={columns} onRowClick={(q) => setSelected(q)} />
      )}

      <QuoteDrawer quote={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} onMarkWon={handleMarkWon} />
      <ConvertQuoteDialog quote={convertQuote} open={!!convertQuote} onOpenChange={(o) => !o && setConvertQuote(null)} onDone={() => setConvertQuote(null)} />
    </div>
  );
}
