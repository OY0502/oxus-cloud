import React from "react";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AvatarStack } from "@/components/AvatarStack";
import { StatusBadge } from "@/components/StatusBadge";
import { Briefcase, Receipt, Users, TrendingUp, ArrowUpRight, Clock } from "lucide-react";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { useProjects, useInvoices, useQuotes, useActivities } from "@/hooks/api";
import { CardGridSkeleton, EmptyState } from "@/components/states/QueryStates";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { formatEUR } from "@/lib/currency";
import { contactInitials } from "@/lib/contacts";
import type { ProjectWithAssignees } from "@/lib/types";

const OWED_STATUSES = ["sent", "viewed", "partial", "overdue"];

export function Dashboard() {
  const [, navigate] = useLocation();
  const { user, isSuperAdmin, accessState } = useAuth();
  const queriesEnabled = isSuperAdmin && accessState === "allowed";

  const { data: projects = [], isLoading: lp } = useProjects({ enabled: queriesEnabled });
  const { data: invoices = [], isLoading: li } = useInvoices({ enabled: queriesEnabled });
  const { data: quotes = [], isLoading: lq } = useQuotes({ enabled: queriesEnabled });
  const { data: activities = [], isLoading: la } = useActivities(5, { enabled: queriesEnabled });

  const firstName = ((user?.user_metadata?.full_name as string | undefined) || user?.email?.split("@")[0] || "there").split(" ")[0];

  const activeProjects = projects.filter((p) => p.status === "in-progress" && !p.is_draft);
  const pendingInvoices = invoices.filter((i) => OWED_STATUSES.includes(i.status));
  const totalPending = pendingInvoices.reduce((acc, i) => acc + (i.amount - i.amount_paid), 0);
  const activeProposals = quotes.filter((q) => q.stage === "proposal");

  const now = new Date();
  const collectedMtd = invoices
    .filter((i) => i.status === "paid" && i.paid_date && new Date(i.paid_date).getMonth() === now.getMonth() && new Date(i.paid_date).getFullYear() === now.getFullYear())
    .reduce((acc, i) => acc + i.amount, 0);

  const avatarUrls = (p: ProjectWithAssignees) => p.team_contacts.map(() => "");
  const avatarInitials = (p: ProjectWithAssignees) => p.team_contacts.map((c) => contactInitials(c.name));

  const dotClass = (kind: string) =>
    kind === "success" ? "bg-soft-green" : kind === "info" ? "bg-periwinkle" : kind === "warning" ? "bg-amber" : "bg-cool-slate";

  const metricsLoading = lp || li || lq;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome back, ${firstName}.`}
        subtitle="Here is what's happening at OXUS today."
        actions={<Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => navigate("/projects/new")}>Create Project</Button>}
      />

      {metricsLoading ? (
        <CardGridSkeleton />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Active Projects" value={activeProjects.length} icon={<Briefcase className="w-5 h-5" />} />
          <MetricCard title="Pending Invoices" value={formatEUR(totalPending)} trend={{ value: `${pendingInvoices.length}`, label: "await payment", positive: false }} icon={<Receipt className="w-5 h-5" />} valueClassName="text-soft-red" />
          <MetricCard title="Active Proposals" value={activeProposals.length} icon={<Users className="w-5 h-5" />} />
          <MetricCard title="Collected (MTD)" value={formatEUR(collectedMtd)} icon={<TrendingUp className="w-5 h-5" />} valueClassName="text-soft-green" />
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-xl font-bold font-serif text-foreground">Today at OXUS</h3>
          {lp ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : activeProjects.length === 0 ? (
            <EmptyState icon={<Briefcase />} title="No active projects" description="Projects you move to 'In Progress' will show up here." action={<Button onClick={() => navigate("/projects/new")}>Create Project</Button>} />
          ) : (
            <Card className="overflow-hidden">
              <div className="p-0">
                {activeProjects.slice(0, 3).map((project, idx) => (
                  <div key={project.id} className={`p-6 flex items-center justify-between transition-colors hover:bg-muted/30 ${idx !== 0 ? "border-t border-border" : ""}`}>
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-periwinkle/15 flex items-center justify-center border border-periwinkle/25"><Briefcase className="w-5 h-5 text-primary" /></div>
                      <div>
                        <h4 className="font-semibold text-foreground">{project.name}</h4>
                        <p className="text-sm text-muted-foreground">{project.client_name ?? "—"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      {project.team_contacts.length > 0 && <AvatarStack urls={avatarUrls(project)} fallbacks={avatarInitials(project)} size="sm" />}
                      <StatusBadge status={project.status} />
                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => navigate("/projects")}><ArrowUpRight className="w-4 h-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-border bg-muted/20 text-center">
                <Button variant="link" className="text-sm text-primary" onClick={() => navigate("/projects")}>View all active projects</Button>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <h3 className="text-xl font-bold font-serif text-foreground">Activity Feed</h3>
          <Card>
            <CardContent className="p-6 space-y-6">
              {la ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
              ) : activities.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No recent activity yet.</p>
              ) : (
                activities.map((activity, i) => (
                  <div key={activity.id} className="flex gap-4">
                    <div className="mt-1 flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full ${dotClass(activity.kind)}`} />
                      {i !== activities.length - 1 && <div className="w-px h-10 bg-border mt-2" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm text-foreground">{activity.title}</h4>
                        <span className="text-xs text-muted-foreground flex items-center"><Clock className="w-3 h-3 mr-1" /> {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}</span>
                      </div>
                      {activity.description && <p className="text-sm text-muted-foreground mt-0.5">{activity.description}</p>}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
