import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { EntityDrawer } from "@/components/EntityDrawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/StatusBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCompanyPeople,
  useTeamMemberSummary,
  useProfiles,
  useTeamMemberStatusChange,
} from "@/hooks/api";
import {
  availabilityLabel,
  availabilityVariant,
  deactivatedAtLabel,
  engagementLabel,
  formatRate,
  isPersonInactive,
  personInitials,
  personStatusVariant,
} from "@/lib/team";
import { formatEUR } from "@/lib/currency";
import type { Contact } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TeamMemberOverview } from "./TeamMemberOverview";
import { TeamMemberProjects } from "./TeamMemberProjects";
import { TeamMemberRatesPanel } from "./TeamMemberRates";
import { TeamMemberPaymentsPanel } from "./TeamMemberPayments";
import { TeamMemberInvoicesPanel } from "./TeamMemberInvoices";
import { TeamMemberAccessPanel } from "./TeamMemberAccess";
import { TeamMemberTabNav, type TeamMemberTab } from "./TeamMemberTabNav";
import {
  ChangeRateDialog,
  RecordPaymentDialog,
  AssignProjectDialog,
  DeleteTeamMemberDialog,
} from "./TeamDialogs";
import {
  TeamIconButton,
  TeamInactiveBanner,
  TeamMiniStat,
  TeamOutlineButton,
  TeamPrimaryButton,
  teamIcon,
} from "./teamUi";
import {
  ExternalLink,
  Mail,
  MoreHorizontal,
  Pencil,
  Wallet,
  DollarSign,
  Briefcase,
  UserCog,
  UserCheck,
  UserX,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type TeamDrawerTab = TeamMemberTab;

interface TeamMemberDrawerProps {
  person: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: TeamDrawerTab;
  onManageAccess?: () => void;
  onPersonUpdated?: (person: Contact) => void;
  onPersonDeleted?: () => void;
}

export function TeamMemberDrawer({
  person,
  open,
  onOpenChange,
  initialTab = "overview",
  onManageAccess,
  onPersonUpdated,
  onPersonDeleted,
}: TeamMemberDrawerProps) {
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const { data: companyPeople = [] } = useCompanyPeople();
  const { data: profiles = [] } = useProfiles();
  const summaryQuery = useTeamMemberSummary(person?.id ?? "", {
    enabled: !!person && isSuperAdmin,
    includeFinancials: isSuperAdmin,
  });
  const statusChange = useTeamMemberStatusChange();

  const [tab, setTab] = useState<TeamDrawerTab>(initialTab);
  const [editing, setEditing] = useState(false);
  const [changeRateOpen, setChangeRateOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [preselectedInvoiceId, setPreselectedInvoiceId] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  React.useEffect(() => {
    if (open) {
      setTab(initialTab);
      setEditing(false);
    }
  }, [open, initialTab, person?.id]);

  const inactive = person ? isPersonInactive(person) : false;
  const engagement = useMemo(
    () => (person ? engagementLabel(person, companyPeople) : null),
    [person, companyPeople],
  );
  const deactivatedLabel = person ? deactivatedAtLabel(person) : null;
  const summary = summaryQuery.data;

  const hasWorkspaceAccount = useMemo(() => {
    const email = person?.email?.trim().toLowerCase();
    if (!email) return false;
    return profiles.some((p) => p.email?.trim().toLowerCase() === email);
  }, [profiles, person?.email]);

  const changeStatus = async (action: "deactivate" | "reactivate") => {
    if (!person) return;
    try {
      const updated = await statusChange.mutateAsync({ person_id: person.id, action });
      onPersonUpdated?.(updated);
      toast({
        title: action === "deactivate" ? "Member deactivated" : "Member reactivated",
        description: updated.name,
      });
    } catch (e) {
      toast({
        title: action === "deactivate" ? "Could not deactivate" : "Could not reactivate",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const openRecordPayment = (invoiceId?: string) => {
    setPreselectedInvoiceId(invoiceId ?? null);
    setRecordPaymentOpen(true);
  };

  if (!person) return null;

  const metadataParts = [
    person.email,
    engagement,
    person.location,
    hasWorkspaceAccount ? "Workspace account" : null,
  ].filter(Boolean);

  return (
    <>
      <EntityDrawer
        open={open}
        onOpenChange={onOpenChange}
        className="sm:max-w-[680px]"
        title={
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Avatar
                className={cn(
                  "h-11 w-11 shrink-0 border",
                  inactive ? "border-border/40 grayscale opacity-80" : "border-border/60",
                )}
              >
                {person.avatar_url ? <AvatarImage src={person.avatar_url} alt={person.name} /> : null}
                <AvatarFallback
                  className={cn(
                    "text-sm font-semibold",
                    inactive ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                  )}
                >
                  {personInitials(person.name)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1 space-y-1">
                <div
                  className={cn(
                    "truncate font-serif text-lg font-semibold leading-tight tracking-tight",
                    inactive && "text-muted-foreground",
                  )}
                >
                  {person.name}
                </div>
                <p className="truncate text-sm text-foreground">{person.job_title ?? "No role set"}</p>
                {metadataParts.length > 0 && (
                  <p className="truncate text-sm text-muted-foreground">{metadataParts.join(" · ")}</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <StatusBadge
                    status={inactive ? "Inactive" : "Active"}
                    variant={personStatusVariant(person.person_status)}
                  />
                  {!inactive && person.availability && (
                    <StatusBadge
                      status={availabilityLabel(person.availability)}
                      variant={availabilityVariant(person.availability)}
                    />
                  )}
                </div>
                {inactive && deactivatedLabel && (
                  <p className="text-xs text-muted-foreground">Deactivated {deactivatedLabel}</p>
                )}
              </div>
            </div>

            {isSuperAdmin && (
              <div className="grid grid-cols-3 gap-2">
                <TeamMiniStat
                  label="Current rate"
                  value={summary?.current_rate ? formatRate(summary.current_rate) : "—"}
                />
                <TeamMiniStat label="Paid MTD" value={formatEUR(summary?.paid_mtd ?? 0)} />
                <TeamMiniStat label="Active projects" value={String(summary?.active_projects ?? 0)} />
              </div>
            )}
          </div>
        }
        headerActions={
          <div className="flex items-center gap-2">
            {isSuperAdmin && !inactive && (
              <TeamPrimaryButton onClick={() => { setTab("overview"); setEditing(true); }}>
                <Pencil className={teamIcon} /> Edit member
              </TeamPrimaryButton>
            )}

            {isSuperAdmin && !inactive && (
              <TeamOutlineButton onClick={() => openRecordPayment()}>
                <Wallet className={teamIcon} /> Record payment
              </TeamOutlineButton>
            )}

            {isSuperAdmin && inactive && (
              <TeamPrimaryButton
                disabled={statusChange.isPending}
                onClick={() => void changeStatus("reactivate")}
              >
                <UserCheck className={teamIcon} /> Reactivate
              </TeamPrimaryButton>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <TeamIconButton aria-label="More actions">
                  <MoreHorizontal className={teamIcon} />
                </TeamIconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {isSuperAdmin && !inactive && (
                  <>
                    <DropdownMenuItem onSelect={() => setChangeRateOpen(true)}>
                      <DollarSign className="mr-2 h-4 w-4" /> Change rate
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setAssignOpen(true)}>
                      <Briefcase className="mr-2 h-4 w-4" /> Assign project
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}

                {isSuperAdmin && hasWorkspaceAccount && (
                  <DropdownMenuItem onSelect={() => setTab("access")}>
                    <UserCog className="mr-2 h-4 w-4" /> Workspace access
                  </DropdownMenuItem>
                )}

                {onManageAccess && isSuperAdmin && !hasWorkspaceAccount && (
                  <DropdownMenuItem onSelect={onManageAccess}>
                    <UserCog className="mr-2 h-4 w-4" /> Workspace access
                  </DropdownMenuItem>
                )}

                {person.email && (
                  <DropdownMenuItem asChild>
                    <a href={`mailto:${person.email}`}>
                      <Mail className="mr-2 h-4 w-4" /> Send email
                    </a>
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem asChild>
                  <Link href={`/team/${person.id}`} className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4" /> Open full profile
                  </Link>
                </DropdownMenuItem>

                {isSuperAdmin && !inactive && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => void changeStatus("deactivate")}
                    >
                      <UserX className="mr-2 h-4 w-4" /> Deactivate member
                    </DropdownMenuItem>
                  </>
                )}

                {isSuperAdmin && inactive && (
                  <DropdownMenuItem onSelect={() => void changeStatus("reactivate")}>
                    <UserCheck className="mr-2 h-4 w-4" /> Reactivate member
                  </DropdownMenuItem>
                )}

                {isSuperAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setDeleteOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete permanently
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      >
        <div className="min-w-0 space-y-4">
          {inactive && (
            <TeamInactiveBanner>
              This member is inactive. History is preserved — reactivate to restore roster actions.
            </TeamInactiveBanner>
          )}

          <TeamMemberTabNav
            value={tab}
            onChange={(v) => { setTab(v); if (v !== "overview") setEditing(false); }}
            showRates={isSuperAdmin}
            showInvoices={isSuperAdmin}
            showPayments={isSuperAdmin}
            showAccess={isSuperAdmin && hasWorkspaceAccount}
          />

          {tab === "overview" && (
            <TeamMemberOverview
              person={person}
              summary={summaryQuery.data}
              canEdit={isSuperAdmin && !inactive}
              showFinancials={isSuperAdmin}
              editing={editing}
              onEditingChange={setEditing}
            />
          )}
          {tab === "projects" && (
            <TeamMemberProjects person={person} canManage={isSuperAdmin && !inactive} />
          )}
          {tab === "rates" && isSuperAdmin && (
            <TeamMemberRatesPanel person={person} canManage={isSuperAdmin && !inactive} />
          )}
          {tab === "invoices" && isSuperAdmin && (
            <TeamMemberInvoicesPanel
              person={person}
              canManage={isSuperAdmin}
              onRecordPayment={openRecordPayment}
            />
          )}
          {tab === "payments" && isSuperAdmin && (
            <TeamMemberPaymentsPanel
              person={person}
              canManage={isSuperAdmin}
              onRecordPayment={() => openRecordPayment()}
            />
          )}
          {tab === "access" && isSuperAdmin && hasWorkspaceAccount && (
            <TeamMemberAccessPanel person={person} />
          )}
        </div>
      </EntityDrawer>

      <ChangeRateDialog open={changeRateOpen} onOpenChange={setChangeRateOpen} person={person} />
      <RecordPaymentDialog
        open={recordPaymentOpen}
        onOpenChange={setRecordPaymentOpen}
        person={person}
        preselectedInvoiceId={preselectedInvoiceId}
      />
      <AssignProjectDialog open={assignOpen} onOpenChange={setAssignOpen} person={person} />
      <DeleteTeamMemberDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        person={person}
        onDeleted={() => {
          setDeleteOpen(false);
          onPersonDeleted?.();
          onOpenChange(false);
        }}
      />
    </>
  );
}
