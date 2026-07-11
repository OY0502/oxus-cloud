import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { EntityDrawer } from "@/components/EntityDrawer";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPin, Mail, Phone, Plus, Shield, Users } from "lucide-react";
import { motion } from "framer-motion";
import { useContacts, useCompanyPeople, usePayouts, useProfiles, useSetProfileRole } from "@/hooks/api";
import { CreateContactDialog } from "@/components/forms/CreateDialogs";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/states/QueryStates";
import { useAuth } from "@/contexts/AuthContext";
import { formatEUR } from "@/lib/currency";
import { normalizeProfileRole, roleLabel } from "@/lib/roles";
import { useToast } from "@/hooks/use-toast";
import type { Contact, ProfileRole } from "@/lib/types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function Team() {
  const [selectedMember, setSelectedMember] = useState<Contact | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "employee" | "contractor" | "inactive">("all");
  const [section, setSection] = useState<"roster" | "access">("roster");
  const { user, isSuperAdmin, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { data: profiles = [] } = useProfiles();
  const setProfileRole = useSetProfileRole();
  const { data: contacts = [], isLoading, isError, error, refetch } = useContacts();
  const { data: companyPeople = [] } = useCompanyPeople();
  const { data: allPayouts = [] } = usePayouts(undefined, { enabled: isSuperAdmin });

  const teamPersonIds = useMemo(() => {
    const ids = new Set<string>();
    for (const rel of companyPeople) {
      if (rel.relationship_type === "employee" || rel.relationship_type === "contractor") {
        ids.add(rel.person_id);
      }
    }
    for (const c of contacts) {
      if (c.type === "contractor" || c.type === "agent") ids.add(c.id);
    }
    return ids;
  }, [companyPeople, contacts]);

  const team = useMemo(() => {
    return contacts.filter((c) => teamPersonIds.has(c.id)).filter((c) => {
      if (filter === "inactive") return c.person_status === "inactive";
      if (filter === "employee") return c.employment_type === "employee";
      if (filter === "contractor") return c.employment_type === "contractor" || c.type === "contractor";
      return c.person_status !== "inactive";
    });
  }, [contacts, teamPersonIds, filter]);

  const payoutSummaryByPerson = useMemo(() => {
    const map = new Map<string, { mtd: number; ytd: number }>();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    for (const p of allPayouts.filter((x) => x.status === "paid")) {
      if (!p.payment_date) continue;
      const d = new Date(p.payment_date);
      const cur = map.get(p.person_id) ?? { mtd: 0, ytd: 0 };
      if (d.getFullYear() === year) cur.ytd += Number(p.amount);
      if (d.getFullYear() === year && d.getMonth() === month) cur.mtd += Number(p.amount);
      map.set(p.person_id, cur);
    }
    return map;
  }, [allPayouts]);

  const availabilityVariant = (a: string | null): "success" | "warning" | "danger" | "neutral" => {
    if (a === "full") return "success";
    if (a === "partial") return "warning";
    if (a === "busy") return "danger";
    return "neutral";
  };

  const superAdminCount = useMemo(
    () => profiles.filter((p) => normalizeProfileRole(p.role) === "super_admin").length,
    [profiles],
  );

  const handleRoleChange = async (userId: string, role: ProfileRole) => {
    try {
      await setProfileRole.mutateAsync({ user_id: userId, role });
      if (userId === user?.id) await refreshProfile();
      toast({ title: "Role updated", description: `${roleLabel(role)} role saved.` });
    } catch (err) {
      toast({
        title: "Could not update role",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const columns = [
    {
      id: "member",
      header: "Member",
      className: "min-w-[220px]",
      cell: (member: Contact) => (
        <Link href={`/team/${member.id}`} className="flex items-center gap-3 hover:underline">
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
        </Link>
      ),
    },
    { id: "role", header: "Role", cell: (member: Contact) => <span className="font-medium text-muted-foreground">{member.job_title ?? "—"}</span> },
    {
      id: "stack",
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
      id: "rate",
      header: "Rate",
      cell: (member: Contact) =>
        member.hourly_rate != null ? (
          <div className="font-medium">{formatEUR(member.hourly_rate)}<span className="text-muted-foreground text-xs font-normal">/hr</span></div>
        ) : <span className="text-muted-foreground">—</span>,
    },
    {
      id: "availability",
      header: "Availability",
      cell: (member: Contact) => <StatusBadge status={member.availability ?? "—"} variant={availabilityVariant(member.availability)} />,
    },
    {
      id: "engagement",
      header: "Engagement",
      cell: (member: Contact) => <span className="capitalize text-muted-foreground">{member.employment_type ?? member.type}</span>,
    },
    ...(isSuperAdmin ? [{
      id: "paid_mtd",
      header: "Paid MTD",
      cell: (member: Contact) => formatEUR(payoutSummaryByPerson.get(member.id)?.mtd ?? 0),
    }] : []),
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <PageHeader
        title="Team"
        subtitle="Workforce dashboard — employees and contractors from the shared people model."
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Team" }]}
        actions={
          isSuperAdmin ? (
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-soft gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> Add member
            </Button>
          ) : undefined
        }
      />

      {isSuperAdmin && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={section === "roster" ? "default" : "outline"} onClick={() => setSection("roster")}>
            <Users className="w-4 h-4 mr-2" /> Roster
          </Button>
          <Button size="sm" variant={section === "access" ? "default" : "outline"} onClick={() => setSection("access")}>
            <Shield className="w-4 h-4 mr-2" /> Workspace access
          </Button>
        </div>
      )}

      {section === "access" && isSuperAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Workspace access</CardTitle>
            <CardDescription>
              Manage OXUS login roles for workspace members. Changes are applied securely on the server and audited.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {profiles.map((profile) => {
              const role = normalizeProfileRole(profile.role);
              const isSelf = profile.id === user?.id;
              const isLastSuperAdmin = role === "super_admin" && superAdminCount <= 1;
              return (
                <div
                  key={profile.id}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{profile.full_name ?? profile.email ?? "User"}</p>
                    <p className="text-xs text-muted-foreground truncate">{profile.email ?? "—"}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Joined {new Date(profile.created_at).toLocaleDateString()}
                      {isSelf ? " · you" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      value={role}
                      disabled={setProfileRole.isPending || isLastSuperAdmin}
                      onValueChange={(value) => void handleRoleChange(profile.id, value as ProfileRole)}
                    >
                      <SelectTrigger className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pm">PM</SelectItem>
                        <SelectItem value="super_admin">Super admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
            {superAdminCount <= 1 && (
              <p className="text-xs text-muted-foreground">
                The last super admin cannot be demoted. Promote another user first.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
      <div className="flex flex-wrap gap-2">
        {(["all", "employee", "contractor", "inactive"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <TableSkeleton columns={6} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : team.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No contractors yet"
          description="Add a contact of type “Contractor” to build your roster and track availability and rates."
          action={isSuperAdmin ? <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" />Add your first contractor</Button> : undefined}
        />
      ) : (
        <DataTable tableId="team-contractors" data={team} columns={columns} onRowClick={setSelectedMember} />
      )}
        </>
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
