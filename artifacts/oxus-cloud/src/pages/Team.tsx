import React, { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { EntityDrawer } from "@/components/EntityDrawer";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Mail, Phone, Plus, Users } from "lucide-react";
import { motion } from "framer-motion";
import { useContacts } from "@/hooks/api";
import { CreateContactDialog } from "@/components/forms/CreateDialogs";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/states/QueryStates";
import { formatEUR } from "@/lib/currency";
import type { Contact } from "@/lib/types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function Team() {
  const [selectedMember, setSelectedMember] = useState<Contact | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { data: contacts = [], isLoading, isError, error, refetch } = useContacts();

  // The roster is everyone in Contacts marked as a contractor.
  const team = useMemo(() => contacts.filter((c) => c.type === "contractor"), [contacts]);

  const availabilityVariant = (a: string | null): "success" | "warning" | "danger" | "neutral" => {
    if (a === "full") return "success";
    if (a === "partial") return "warning";
    if (a === "busy") return "danger";
    return "neutral";
  };

  const columns = [
    {
      header: "Member",
      className: "min-w-[220px]",
      cell: (member: Contact) => (
        <div className="flex items-center gap-3">
          <Avatar className="w-10 h-10 border-2 border-background shadow-sm">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold">{initials(member.name)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-semibold text-foreground">{member.name}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" />
              {member.location ?? "—"}
            </div>
          </div>
        </div>
      ),
    },
    { header: "Role", cell: (member: Contact) => <span className="font-medium text-muted-foreground">{member.job_title ?? "—"}</span> },
    {
      header: "Stack",
      cell: (member: Contact) => (
        <div className="flex flex-wrap gap-1.5">
          {member.stack.slice(0, 2).map((tech, i) => (
            <Badge key={i} variant="outline" className="bg-muted/50 font-normal">{tech}</Badge>
          ))}
          {member.stack.length > 2 && <Badge variant="outline" className="bg-muted/50 font-normal">+{member.stack.length - 2}</Badge>}
        </div>
      ),
    },
    {
      header: "Rate",
      cell: (member: Contact) =>
        member.hourly_rate != null ? (
          <div className="font-medium">{formatEUR(member.hourly_rate)}<span className="text-muted-foreground text-xs font-normal">/hr</span></div>
        ) : <span className="text-muted-foreground">—</span>,
    },
    {
      header: "Availability",
      cell: (member: Contact) => <StatusBadge status={member.availability ?? "—"} variant={availabilityVariant(member.availability)} />,
    },
    {
      header: "Engagement",
      cell: (member: Contact) => <span className="capitalize text-muted-foreground">{member.employment_type ?? "—"}</span>,
    },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <PageHeader
        title="Team & Contractors"
        subtitle="Your roster of contractors, sourced from Contacts."
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Team" }]}
        actions={
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-soft gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> Add Contractor
          </Button>
        }
      />

      {isLoading ? (
        <TableSkeleton columns={6} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : team.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No contractors yet"
          description="Add a contact of type “Contractor” to build your roster and track availability and rates."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" />Add your first contractor</Button>}
        />
      ) : (
        <DataTable data={team} columns={columns} onRowClick={setSelectedMember} />
      )}

      <CreateContactDialog open={createOpen} onOpenChange={setCreateOpen} defaultType="contractor" />

      <EntityDrawer
        open={!!selectedMember}
        onOpenChange={(open) => !open && setSelectedMember(null)}
        title={
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12 border-2 border-background shadow-sm">
              <AvatarFallback className="bg-primary/10 text-primary font-semibold">{selectedMember ? initials(selectedMember.name) : "?"}</AvatarFallback>
            </Avatar>
            <div>
              <div>{selectedMember?.name}</div>
              <div className="text-sm text-muted-foreground font-sans font-normal flex items-center gap-2 mt-1">
                <span className="capitalize">{selectedMember?.employment_type ?? "contractor"}</span>
                <span>•</span>
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{selectedMember?.location ?? "—"}</span>
              </div>
            </div>
          </div>
        }
        headerActions={
          <>
            <Button variant="outline" size="icon" asChild>
              <a href={selectedMember?.email ? `mailto:${selectedMember.email}` : undefined}><Mail className="w-4 h-4" /></a>
            </Button>
            <Button variant="outline" size="icon" asChild>
              <a href={selectedMember?.phone ? `tel:${selectedMember.phone}` : undefined}><Phone className="w-4 h-4" /></a>
            </Button>
          </>
        }
      >
        {selectedMember && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <Card className="shadow-none border-border/50 bg-muted/20">
                <CardContent className="p-4">
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Role</div>
                  <div className="font-semibold text-lg">{selectedMember.job_title ?? "—"}</div>
                </CardContent>
              </Card>
              <Card className="shadow-none border-border/50 bg-muted/20">
                <CardContent className="p-4">
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Hourly Rate</div>
                  <div className="font-semibold text-lg">{selectedMember.hourly_rate != null ? <>{formatEUR(selectedMember.hourly_rate)}<span className="text-sm font-normal text-muted-foreground">/hr</span></> : "—"}</div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Card className="shadow-none border-border/50 bg-muted/20">
                <CardContent className="p-4">
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Availability</div>
                  <div className="font-semibold text-lg capitalize">{selectedMember.availability ?? "—"}</div>
                </CardContent>
              </Card>
              <Card className="shadow-none border-border/50 bg-muted/20">
                <CardContent className="p-4">
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Company</div>
                  <div className="font-semibold text-lg">{selectedMember.company ?? "—"}</div>
                </CardContent>
              </Card>
            </div>

            {selectedMember.stack.length > 0 && (
              <Card className="shadow-none border-border/50">
                <CardHeader className="pb-3 px-5 pt-5"><CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Tech Stack</CardTitle></CardHeader>
                <CardContent className="px-5 pb-5">
                  <div className="flex flex-wrap gap-2">
                    {selectedMember.stack.map((tech, i) => (
                      <Badge key={i} variant="secondary" className="bg-muted px-3 py-1 font-medium">{tech}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {selectedMember.notes && (
              <Card className="shadow-none border-border/50 bg-amber-50/50 dark:bg-amber-950/10">
                <CardHeader className="pb-2 px-5 pt-5"><CardTitle className="text-sm font-medium text-amber-800 dark:text-amber-500 uppercase tracking-wider">Notes</CardTitle></CardHeader>
                <CardContent className="px-5 pb-5 text-sm text-amber-900 dark:text-amber-400/90 leading-relaxed">{selectedMember.notes}</CardContent>
              </Card>
            )}
          </div>
        )}
      </EntityDrawer>
    </motion.div>
  );
}
