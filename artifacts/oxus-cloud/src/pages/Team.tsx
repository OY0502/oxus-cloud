import React, { useState } from "react";
import { teamData } from "@/data/mock";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { EntityDrawer } from "@/components/EntityDrawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Mail, Briefcase, FileText, CheckCircle2, Clock } from "lucide-react";
import { motion } from "framer-motion";

export function Team() {
  const [selectedMember, setSelectedMember] = useState<any>(null);

  const columns = [
    {
      header: "Member",
      cell: (member: any) => (
        <div className="flex items-center gap-3">
          <Avatar className="w-10 h-10 border-2 border-background shadow-sm">
            <AvatarImage src={member.avatar} />
            <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-semibold text-foreground">{member.name}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" />
              {member.location}
            </div>
          </div>
        </div>
      ),
      className: "w-[250px]",
    },
    {
      header: "Role",
      accessorKey: "role" as any,
      cell: (member: any) => (
        <span className="font-medium text-muted-foreground">{member.role}</span>
      ),
    },
    {
      header: "Stack",
      cell: (member: any) => (
        <div className="flex flex-wrap gap-1.5">
          {member.stack.slice(0, 2).map((tech: string, i: number) => (
            <Badge key={i} variant="outline" className="bg-muted/50 font-normal">
              {tech}
            </Badge>
          ))}
          {member.stack.length > 2 && (
            <Badge variant="outline" className="bg-muted/50 font-normal">
              +{member.stack.length - 2}
            </Badge>
          )}
        </div>
      ),
    },
    {
      header: "Rate",
      cell: (member: any) => (
        <div className="font-medium">${member.rate}<span className="text-muted-foreground text-xs font-normal">/hr</span></div>
      ),
    },
    {
      header: "Availability",
      cell: (member: any) => {
        let variant: "success" | "warning" | "danger" | "neutral" = "neutral";
        if (member.availability === "full") variant = "success";
        if (member.availability === "partial") variant = "warning";
        if (member.availability === "busy") variant = "danger";
        if (member.availability === "unavailable") variant = "neutral";
        return <StatusBadge status={member.availability} variant={variant} />;
      },
    },
    {
      header: "Workload",
      cell: (member: any) => (
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium">
            {member.activeProjects} Active Projects
          </div>
          {member.unpaidInvoices > 0 ? (
            <div className="text-xs text-soft-red font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" /> {member.unpaidInvoices} Unpaid Invoices
            </div>
          ) : (
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> All paid up
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Status",
      cell: (member: any) => (
        <StatusBadge status={member.status} />
      ),
    },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <PageHeader
        title="Team & Contractors"
        subtitle="Manage your roster, monitor availability, and track contractor invoices."
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Team" }]}
        actions={
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-soft">
            Add Team Member
          </Button>
        }
      />

      <DataTable
        data={teamData}
        columns={columns}
        onRowClick={setSelectedMember}
      />

      <EntityDrawer
        open={!!selectedMember}
        onOpenChange={(open) => !open && setSelectedMember(null)}
        title={
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12 border-2 border-background shadow-sm">
              <AvatarImage src={selectedMember?.avatar} />
              <AvatarFallback>{selectedMember?.name?.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <div>{selectedMember?.name}</div>
              <div className="text-sm text-muted-foreground font-sans font-normal flex items-center gap-2 mt-1">
                <StatusBadge status={selectedMember?.status || "Unknown"} />
                <span>•</span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {selectedMember?.location}
                </span>
              </div>
            </div>
          </div>
        }
        headerActions={
          <>
            <Button variant="outline" size="icon">
              <Mail className="w-4 h-4" />
            </Button>
            <Button>Assign Project</Button>
          </>
        }
      >
        {selectedMember && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <Card className="shadow-none border-border/50 bg-muted/20">
                <CardContent className="p-4">
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Role</div>
                  <div className="font-semibold text-lg">{selectedMember.role}</div>
                </CardContent>
              </Card>
              <Card className="shadow-none border-border/50 bg-muted/20">
                <CardContent className="p-4">
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Hourly Rate</div>
                  <div className="font-semibold text-lg">${selectedMember.rate}<span className="text-sm font-normal text-muted-foreground">/hr</span></div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Card className="shadow-none border-border/50 bg-muted/20">
                <CardContent className="p-4">
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5" />
                    Active Projects
                  </div>
                  <div className="font-semibold text-lg">{selectedMember.activeProjects}</div>
                </CardContent>
              </Card>
              <Card className={selectedMember.unpaidInvoices > 0 ? "shadow-none border-soft-red/30 bg-soft-red/5" : "shadow-none border-border/50 bg-muted/20"}>
                <CardContent className="p-4">
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    Unpaid Invoices
                  </div>
                  <div className={selectedMember.unpaidInvoices > 0 ? "font-semibold text-lg text-soft-red" : "font-semibold text-lg"}>
                    {selectedMember.unpaidInvoices}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-none border-border/50">
              <CardHeader className="pb-3 px-5 pt-5">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Tech Stack</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="flex flex-wrap gap-2">
                  {selectedMember.stack.map((tech: string, i: number) => (
                    <Badge key={i} variant="secondary" className="bg-muted px-3 py-1 font-medium">
                      {tech}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-none border-border/50 bg-amber-50/50 dark:bg-amber-950/10">
              <CardHeader className="pb-2 px-5 pt-5">
                <CardTitle className="text-sm font-medium text-amber-800 dark:text-amber-500 uppercase tracking-wider">Management Notes</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 text-sm text-amber-900 dark:text-amber-400/90 leading-relaxed">
                {selectedMember.notes}
              </CardContent>
            </Card>

          </div>
        )}
      </EntityDrawer>
    </motion.div>
  );
}
