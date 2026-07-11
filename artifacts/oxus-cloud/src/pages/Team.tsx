import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricCard } from "@/components/MetricCard";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Plus, Users, MoreHorizontal, Briefcase, Wallet, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { useProjects, useTeamKpis, useTeamRoster, useCompanyPeople } from "@/hooks/api";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/states/QueryStates";
import { useAuth } from "@/contexts/AuthContext";
import { formatEUR } from "@/lib/currency";
import {
  deactivatedAtLabel,
  filterTeamRoster,
  formatRate,
  isPersonInactive,
  personInitials,
  personStatusVariant,
  projectNamesCell,
  rosterAvailabilityLabel,
  rosterAvailabilityVariant,
  rosterEngagementLabel,
  type EngagementFilter,
  type AvailabilityFilter,
} from "@/lib/team";
import type { Contact, TeamRosterRow } from "@/lib/types";
import { TeamMemberDrawer, type TeamDrawerTab } from "@/components/team/TeamMemberDrawer";
import { AddTeamMemberDrawer } from "@/components/team/AddTeamMemberDrawer";
import { WorkspaceAccessTable } from "@/components/team/WorkspaceAccessTable";
import { teamActionBtn, teamIcon, teamTableRowClass } from "@/components/team/teamUi";
import { fromSelectValue, toSelectValue } from "@/components/forms/FormKit";
import { cn } from "@/lib/utils";

export function Team() {
  const { isSuperAdmin } = useAuth();
  const [section, setSection] = useState<"roster" | "access">("roster");
  const [engagementFilter, setEngagementFilter] = useState<EngagementFilter>("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [projectFilter, setProjectFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<Contact | null>(null);
  const [drawerTab, setDrawerTab] = useState<TeamDrawerTab>("overview");
  const [addOpen, setAddOpen] = useState(false);

  const rosterQuery = useTeamRoster({ includeFinancials: isSuperAdmin });
  const kpisQuery = useTeamKpis({ includeFinancials: isSuperAdmin });
  const projectsQuery = useProjects();
  const { data: companyPeople = [] } = useCompanyPeople();

  const teamPersonIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rosterQuery.data ?? []) ids.add(row.person.id);
    return ids;
  }, [rosterQuery.data]);

  const rosterMap = useMemo(() => {
    const map = new Map<string, TeamRosterRow>();
    for (const row of rosterQuery.data ?? []) map.set(row.person.id, row);
    return map;
  }, [rosterQuery.data]);

  const drawerPerson = useMemo(() => {
    if (!selectedMember) return null;
    return rosterMap.get(selectedMember.id)?.person ?? selectedMember;
  }, [selectedMember, rosterMap]);

  const filteredTeam = useMemo(() => {
    const contacts = (rosterQuery.data ?? []).map((r) => r.person);
    return filterTeamRoster(
      contacts,
      teamPersonIds,
      engagementFilter,
      availabilityFilter,
      projectFilter || null,
      search,
      projectsQuery.data ?? [],
    );
  }, [
    rosterQuery.data,
    teamPersonIds,
    engagementFilter,
    availabilityFilter,
    projectFilter,
    search,
    projectsQuery.data,
  ]);

  const openDrawer = (member: Contact, tab: TeamDrawerTab = "overview") => {
    setDrawerTab(tab);
    setSelectedMember(member);
  };

  const columns = [
    {
      id: "member",
      header: "Member",
      className: "min-w-[220px]",
      defaultWidth: 240,
      cell: (member: Contact) => {
        const inactive = isPersonInactive(member);
        const deactivated = deactivatedAtLabel(member);
        return (
          <div className="flex items-center gap-3">
            <Avatar
              className={cn(
                "h-9 w-9 border border-border",
                inactive && "grayscale opacity-70",
              )}
            >
              <AvatarFallback
                className={cn(
                  "text-xs font-semibold",
                  inactive ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                )}
              >
                {personInitials(member.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <button
                type="button"
                className={cn(
                  "block max-w-[180px] truncate text-left text-sm hover:underline",
                  inactive ? "font-medium text-muted-foreground" : "font-semibold text-foreground",
                )}
                onClick={(e) => { e.stopPropagation(); openDrawer(member); }}
              >
                {member.name}
              </button>
              <div className="truncate text-xs text-muted-foreground">
                {member.email ?? member.job_title ?? "—"}
              </div>
              {inactive && deactivated && (
                <div className="truncate text-xs text-muted-foreground/90">Deactivated {deactivated}</div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      id: "role",
      header: "Role",
      cell: (member: Contact) => (
        <span className="text-sm text-muted-foreground">{member.job_title ?? "—"}</span>
      ),
    },
    {
      id: "engagement",
      header: "Engagement",
      cell: (member: Contact) => (
        <span className="text-sm text-muted-foreground">
          {rosterEngagementLabel(member, companyPeople)}
        </span>
      ),
    },
    ...(isSuperAdmin
      ? [{
          id: "rate",
          header: "Current rate",
          cell: (member: Contact) => {
            const rate = rosterMap.get(member.id)?.current_rate;
            const inactive = isPersonInactive(member);
            return rate ? (
              <span className={cn(
                "font-serif text-sm font-semibold tabular-nums",
                inactive && "text-muted-foreground",
              )}>
                {formatRate(rate)}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            );
          },
        }]
      : []),
    {
      id: "status",
      header: "Status",
      cell: (member: Contact) => (
        <StatusBadge
          status={isPersonInactive(member) ? "Inactive" : "Active"}
          variant={personStatusVariant(member.person_status)}
        />
      ),
    },
    {
      id: "availability",
      header: "Availability",
      cell: (member: Contact) => {
        if (isPersonInactive(member)) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        return (
          <StatusBadge
            status={rosterAvailabilityLabel(member)}
            variant={rosterAvailabilityVariant(member)}
          />
        );
      },
    },
    {
      id: "projects",
      header: "Active projects",
      className: "min-w-[160px]",
      cell: (member: Contact) => {
        const projects = rosterMap.get(member.id)?.active_projects ?? [];
        return <span className="text-sm text-muted-foreground">{projectNamesCell(projects)}</span>;
      },
    },
    ...(isSuperAdmin
      ? [
          {
            id: "paid_mtd",
            header: "Paid MTD",
            cell: (member: Contact) => (
              <span className="font-serif text-sm tabular-nums">
                {formatEUR(rosterMap.get(member.id)?.paid_mtd ?? 0)}
              </span>
            ),
          },
          {
            id: "paid_ytd",
            header: "Paid YTD",
            cell: (member: Contact) => (
              <span className="font-serif text-sm tabular-nums">
                {formatEUR(rosterMap.get(member.id)?.paid_ytd ?? 0)}
              </span>
            ),
          },
          {
            id: "last_payment",
            header: "Last payment",
            cell: (member: Contact) => (
              <span className="text-sm text-muted-foreground">
                {rosterMap.get(member.id)?.last_payment_date ?? "—"}
              </span>
            ),
          },
        ]
      : []),
    {
      id: "actions",
      header: "",
      defaultWidth: 48,
      resizable: false,
      cell: (member: Contact) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className={teamActionBtn.menu}>
              <MoreHorizontal className={teamIcon} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => openDrawer(member)}>View profile</DropdownMenuItem>
            {isSuperAdmin && (
              <>
                <DropdownMenuItem onSelect={() => openDrawer(member, "overview")}>Edit member</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openDrawer(member, "rates")}>Change rate</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openDrawer(member, "payments")}>Record payment</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openDrawer(member, "projects")}>Assign project</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { setSection("access"); }}>Manage workspace access</DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem asChild>
              <Link href={`/team/${member.id}`} className="flex items-center gap-2">
                <ExternalLink className="h-3.5 w-3.5" /> Open full profile
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const kpis = kpisQuery.data;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <PageHeader
        title="Team"
        subtitle="Manage OXUS employees and contractors — roster, availability, projects, and workspace access."
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Team" }]}
        actions={
          isSuperAdmin ? (
            <Button className={cn("gap-2", teamActionBtn.primary)} onClick={() => setAddOpen(true)}>
              <Plus className={teamIcon} /> Add member
            </Button>
          ) : undefined
        }
      />

      {kpis && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <MetricCard title="Active team" value={String(kpis.active_team)} icon={<Users className={teamIcon} />} className="shadow-none" valueClassName="text-2xl" />
          <MetricCard title="Employees" value={String(kpis.employees)} className="shadow-none" valueClassName="text-2xl" />
          <MetricCard title="Contractors" value={String(kpis.contractors)} className="shadow-none" valueClassName="text-2xl" />
          <MetricCard
            title="Available / partial"
            value={kpis.has_capacity_data && kpis.available_capacity != null ? String(kpis.available_capacity) : "—"}
            subtitle={!kpis.has_capacity_data ? "Set availability on members" : undefined}
            className="shadow-none"
            valueClassName="text-2xl"
          />
          {isSuperAdmin && kpis.has_payout_data && (
            <MetricCard
              title="Paid this month"
              value={formatEUR(kpis.paid_this_month ?? 0)}
              icon={<Wallet className={teamIcon} />}
              className="shadow-none"
              valueClassName="text-2xl"
            />
          )}
        </div>
      )}

      <Tabs value={section} onValueChange={(v) => setSection(v as "roster" | "access")}>
        <TabsList className="h-auto gap-1 bg-transparent p-0">
          <TabsTrigger value="roster" className="tab-trigger-underline gap-2 text-sm">
            <Users className={teamIcon} /> Roster
          </TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="access" className="tab-trigger-underline gap-2 text-sm">
              <Briefcase className={teamIcon} /> Workspace Access
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="roster" className="mt-5 space-y-4">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <ToggleGroup
              type="single"
              value={engagementFilter}
              onValueChange={(v) => v && setEngagementFilter(v as EngagementFilter)}
              className="flex-wrap justify-start"
            >
              {(["all", "employee", "contractor", "inactive"] as const).map((f) => (
                <ToggleGroupItem key={f} value={f} size="sm" className="h-8 px-3 text-sm">
                  {f === "all" ? "Active" : f === "inactive" ? "Inactive" : f.charAt(0).toUpperCase() + f.slice(1)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 pl-9 text-sm"
                  placeholder="Search team…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={availabilityFilter} onValueChange={(v) => setAvailabilityFilter(v as AvailabilityFilter)}>
                <SelectTrigger className="h-9 w-[148px] text-sm"><SelectValue placeholder="Availability" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All availability</SelectItem>
                  <SelectItem value="full">Available</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="busy">Fully allocated</SelectItem>
                  <SelectItem value="unavailable">Unavailable</SelectItem>
                </SelectContent>
              </Select>
              <Select value={toSelectValue(projectFilter)} onValueChange={(v) => setProjectFilter(fromSelectValue(v))}>
                <SelectTrigger className="h-9 w-[160px] text-sm"><SelectValue placeholder="Project" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={toSelectValue("")}>All projects</SelectItem>
                  {(projectsQuery.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {rosterQuery.isLoading ? (
            <TableSkeleton columns={8} />
          ) : rosterQuery.isError ? (
            <ErrorState error={rosterQuery.error} onRetry={() => void rosterQuery.refetch()} />
          ) : filteredTeam.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title="No team members"
              description="Add employees and contractors to track availability, projects, and compensation."
              action={isSuperAdmin ? (
                <Button className="gap-2" onClick={() => setAddOpen(true)}>
                  <Plus className={teamIcon} /> Add member
                </Button>
              ) : undefined}
            />
          ) : (
            <DataTable
              tableId="team-roster"
              data={filteredTeam}
              columns={columns}
              onRowClick={(member) => openDrawer(member)}
              getRowClassName={(member) => teamTableRowClass(isPersonInactive(member))}
            />
          )}
        </TabsContent>

        {isSuperAdmin && (
          <TabsContent value="access" className="mt-5">
            <WorkspaceAccessTable />
          </TabsContent>
        )}
      </Tabs>

      <TeamMemberDrawer
        person={drawerPerson}
        open={!!selectedMember}
        onOpenChange={(open) => !open && setSelectedMember(null)}
        initialTab={drawerTab}
        onManageAccess={() => { setSelectedMember(null); setSection("access"); }}
        onPersonUpdated={(person) => setSelectedMember(person)}
        onPersonDeleted={() => setSelectedMember(null)}
      />

      <AddTeamMemberDrawer
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(id) => {
          const person = rosterQuery.data?.find((r) => r.person.id === id)?.person;
          if (person) openDrawer(person);
        }}
      />
    </motion.div>
  );
}
