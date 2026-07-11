import React, { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable } from "@/components/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  useContacts, useCreateTeamMemberRate, usePayouts, useTeamMemberRates, useTeamMemberSummary,
} from "@/hooks/api";
import { TableSkeleton, ErrorState } from "@/components/states/QueryStates";
import { useAuth } from "@/contexts/AuthContext";
import { formatEUR } from "@/lib/currency";
import { ArrowLeft, Briefcase, Clock, Wallet } from "lucide-react";
import type { Payout, TeamMemberRate } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TeamMemberDetail() {
  const [, params] = useRoute("/team/:id");
  const personId = params?.id ?? "";
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState("overview");
  const [newRate, setNewRate] = useState({ amount: "", effective_from: new Date().toISOString().slice(0, 10) });

  const contactsQuery = useContacts();
  const summaryQuery = useTeamMemberSummary(personId);
  const ratesQuery = useTeamMemberRates(personId);
  const payoutsQuery = usePayouts(personId);
  const createRate = useCreateTeamMemberRate();

  const person = contactsQuery.data?.find((c) => c.id === personId);
  const summary = summaryQuery.data;
  const rates = ratesQuery.data ?? [];
  const payouts = payoutsQuery.data ?? [];

  const rateColumns = [
    { id: "type", header: "Type", cell: (r: TeamMemberRate) => r.rate_type },
    { id: "amount", header: "Amount", cell: (r: TeamMemberRate) => formatEUR(r.amount) },
    { id: "from", header: "From", cell: (r: TeamMemberRate) => r.effective_from },
    { id: "to", header: "To", cell: (r: TeamMemberRate) => r.effective_to ?? "Current" },
  ];

  const payoutColumns = [
    { id: "date", header: "Date", cell: (p: Payout) => p.payment_date ?? "—" },
    { id: "amount", header: "Amount", cell: (p: Payout) => formatEUR(p.amount) },
    { id: "provider", header: "Provider", cell: (p: Payout) => <StatusBadge status={p.provider} variant="neutral" /> },
    { id: "status", header: "Status", cell: (p: Payout) => <StatusBadge status={p.status} variant="neutral" /> },
  ];

  const handleAddRate = async () => {
    const amount = parseFloat(newRate.amount);
    if (!amount || amount <= 0) return;
    try {
      await createRate.mutateAsync({
        person_id: personId,
        rate_type: "hourly",
        amount,
        effective_from: newRate.effective_from,
      });
      setNewRate({ amount: "", effective_from: new Date().toISOString().slice(0, 10) });
      toast({ title: "Rate saved", description: "Previous rate history preserved." });
    } catch (e) {
      toast({ title: "Could not save rate", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  };

  if (contactsQuery.isLoading) return <TableSkeleton rows={4} />;
  if (!person) return <ErrorState error={new Error("Team member not found.")} onRetry={() => void contactsQuery.refetch()} />;

  const currentRate = summary?.current_rate;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" asChild><Link href="/team"><ArrowLeft className="w-4 h-4" /></Link></Button>
        <Avatar className="w-14 h-14 border-2">
          {person.avatar_url ? <AvatarImage src={person.avatar_url} alt={person.name} /> : null}
          <AvatarFallback className="text-lg">{initials(person.name)}</AvatarFallback>
        </Avatar>
        <div>
          <PageHeader title={person.name} subtitle={[person.job_title, person.employment_type].filter(Boolean).join(" · ") || person.type} />
          <p className="text-sm text-muted-foreground">{person.email ?? "No email"}</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rates">Rates</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="payments">Payments</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Current rate"
              value={currentRate ? `${formatEUR(currentRate.amount)}/hr` : "—"}
              icon={<Clock className="w-5 h-5" />}
            />
            <MetricCard title="Paid this month" value={formatEUR(summary?.paid_mtd ?? 0)} icon={<Wallet className="w-5 h-5" />} />
            <MetricCard title="Paid YTD" value={formatEUR(summary?.paid_ytd ?? 0)} icon={<Wallet className="w-5 h-5" />} />
            <MetricCard title="Active projects" value={String(summary?.active_projects ?? 0)} icon={<Briefcase className="w-5 h-5" />} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Workload</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <p><span className="text-muted-foreground">Availability:</span> {person.availability ?? "—"}</p>
              <p><span className="text-muted-foreground">Location:</span> {person.location ?? "—"}</p>
              <p><span className="text-muted-foreground">Last payment:</span> {summary?.last_payment_date ?? "—"}</p>
              {isSuperAdmin && <p><span className="text-muted-foreground">Pending:</span> {formatEUR(summary?.pending ?? 0)}</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rates" className="mt-6 space-y-4">
          {isSuperAdmin && (
            <Card>
              <CardHeader><CardTitle className="text-base">Add new rate</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-4 items-end">
                <div className="space-y-1">
                  <Label>Hourly rate (EUR)</Label>
                  <Input type="number" value={newRate.amount} onChange={(e) => setNewRate((s) => ({ ...s, amount: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Effective from</Label>
                  <Input type="date" value={newRate.effective_from} onChange={(e) => setNewRate((s) => ({ ...s, effective_from: e.target.value }))} />
                </div>
                <Button onClick={() => void handleAddRate()} disabled={createRate.isPending}>Save rate</Button>
              </CardContent>
            </Card>
          )}
          <DataTable tableId="team-member-rates" data={rates} columns={rateColumns} />
        </TabsContent>

        {isSuperAdmin && (
          <TabsContent value="payments" className="mt-6">
            <DataTable tableId="team-member-payouts" data={payouts} columns={payoutColumns} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
