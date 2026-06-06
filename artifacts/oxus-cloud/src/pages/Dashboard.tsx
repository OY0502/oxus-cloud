import React from "react";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AvatarStack } from "@/components/AvatarStack";
import { StatusBadge } from "@/components/StatusBadge";
import { 
  Briefcase, 
  Receipt, 
  Users, 
  TrendingUp, 
  ArrowUpRight,
  Clock
} from "lucide-react";
import { projectsData, invoicesData, quotesData } from "@/data/mock";

export function Dashboard() {
  const activeProjects = projectsData.filter(p => p.status === 'in-progress');
  const pendingInvoices = invoicesData.filter(i => i.status === 'pending' || i.status === 'overdue');
  const totalPendingInvoices = pendingInvoices.reduce((acc, curr) => acc + curr.amount, 0);
  const activeProposals = quotesData.filter(q => q.status === 'sent');

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Welcome back, Alex."
        subtitle="Here is what's happening at OXUS today."
        actions={
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            Create Project
          </Button>
        }
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard 
          title="Active Projects"
          value={activeProjects.length}
          trend={{ value: "+2", label: "this month", positive: true }}
          icon={<Briefcase className="w-5 h-5" />}
        />
        <MetricCard 
          title="Pending Invoices"
          value={`$${totalPendingInvoices.toLocaleString()}`}
          trend={{ value: `${pendingInvoices.length}`, label: "await payment", positive: false }}
          icon={<Receipt className="w-5 h-5" />}
          valueClassName="text-soft-red"
        />
        <MetricCard 
          title="Active Proposals"
          value={activeProposals.length}
          trend={{ value: "40%", label: "win rate", positive: true }}
          icon={<Users className="w-5 h-5" />}
        />
        <MetricCard 
          title="Monthly Recurring"
          value="$32,450"
          trend={{ value: "+12%", label: "from last month", positive: true }}
          icon={<TrendingUp className="w-5 h-5" />}
          valueClassName="text-soft-green"
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-xl font-bold font-serif text-foreground">Today at OXUS</h3>
          <Card className="bg-card border-border shadow-soft overflow-hidden">
            <div className="p-0">
              {activeProjects.slice(0, 3).map((project, idx) => (
                <div key={project.id} className={`p-6 flex items-center justify-between transition-colors hover:bg-muted/30 ${idx !== 0 ? 'border-t border-border' : ''}`}>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center border border-primary/10">
                      <Briefcase className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground">{project.name}</h4>
                      <p className="text-sm text-muted-foreground">{project.client}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <AvatarStack urls={project.assignees} size="sm" />
                    <StatusBadge status={project.status} />
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                      <ArrowUpRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-border bg-muted/20 text-center">
              <Button variant="link" className="text-sm text-primary">View all active projects</Button>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <h3 className="text-xl font-bold font-serif text-foreground">Activity Feed</h3>
          <Card className="bg-card border-border shadow-soft">
            <CardContent className="p-6 space-y-6">
              {[
                { time: "2h ago", title: "Invoice Paid", desc: "Globex Logistics paid $11,000", type: "success" },
                { time: "4h ago", title: "Quote Accepted", desc: "Verdant Farms accepted QT-2026-007", type: "info" },
                { time: "Yesterday", title: "New Lead", desc: "Brightside Coffee added to pipeline", type: "default" },
                { time: "Yesterday", title: "Project Milestone", desc: "Mobile Banking App reached 50%", type: "warning" },
              ].map((activity, i) => (
                <div key={i} className="flex gap-4">
                  <div className="mt-1 flex flex-col items-center">
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      activity.type === 'success' ? 'bg-soft-green' : 
                      activity.type === 'info' ? 'bg-logo-blue' : 
                      activity.type === 'warning' ? 'bg-warm-yellow' : 'bg-muted-foreground'
                    }`} />
                    {i !== 3 && <div className="w-px h-10 bg-border mt-2" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-sm text-foreground">{activity.title}</h4>
                      <span className="text-xs text-muted-foreground flex items-center"><Clock className="w-3 h-3 mr-1" /> {activity.time}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{activity.desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
