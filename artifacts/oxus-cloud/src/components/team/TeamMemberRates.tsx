import React, { useMemo, useState } from "react";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useTeamMemberRates,
  useManageTeamMemberRate,
  useRateUsageCheck,
  useProjects,
} from "@/hooks/api";
import { formatRate } from "@/lib/team";
import {
  getDefaultRate,
  rateScopeLabel,
  rateStatusVariant,
  formatRateDescription,
} from "@/lib/teamMemberRates";
import type { Contact, TeamMemberRate } from "@/lib/types";
import { RateDialog } from "./TeamDialogs";
import { ChevronDown, History, MoreHorizontal, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TeamMiniStat, TeamOutlineButton, TeamPanelHeader, teamActionBtn, teamIcon } from "./teamUi";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

function RateStatusBadge({ status }: { status: TeamMemberRate["status"] }) {
  return <StatusBadge status={status} variant={rateStatusVariant(status)} />;
}
export function TeamMemberRatesPanel({
  person,
  canManage,
}: {
  person: Contact;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const { data: rates = [], isLoading } = useTeamMemberRates(person.id, { enabled: canManage });
  const { data: projects = [] } = useProjects();
  const manageRate = useManageTeamMemberRate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRate, setEditRate] = useState<TeamMemberRate | null>(null);
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | "duplicate" | "replace">("create");
  const [showHistory, setShowHistory] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const defaultRate = getDefaultRate(rates, today);
  const activeRates = rates.filter((r) => r.status === "active");
  const scheduledRates = rates.filter((r) => r.status === "scheduled");
  const historicalRates = rates.filter((r) => r.status === "expired");

  const openCreate = () => {
    setEditRate(null);
    setDialogMode("create");
    setDialogOpen(true);
  };

  const openEdit = (rate: TeamMemberRate) => {
    setEditRate(rate);
    setDialogMode("edit");
    setDialogOpen(true);
  };

  const handleEnd = async (rate: TeamMemberRate) => {
    try {
      await manageRate.mutateAsync({
        action: "end",
        person_id: person.id,
        rate_id: rate.id,
        effective_to: today,
      });
      toast({ title: "Rate ended", description: rate.name ?? formatRate(rate) });
    } catch (e) {
      toast({
        title: "Could not end rate",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const handleSetDefault = async (rate: TeamMemberRate) => {
    try {
      await manageRate.mutateAsync({
        action: "set_default",
        person_id: person.id,
        rate_id: rate.id,
      });
      toast({ title: "Default rate updated" });
    } catch (e) {
      toast({
        title: "Could not set default",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (rate: TeamMemberRate) => {
    try {
      await manageRate.mutateAsync({
        action: "delete",
        person_id: person.id,
        rate_id: rate.id,
      });
      toast({ title: "Rate deleted" });
    } catch (e) {
      toast({
        title: "Could not delete rate",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const columns = [
    {
      id: "name",
      header: "Rate name",
      cell: (r: TeamMemberRate) => (
        <div>
          <div className="font-medium">{r.name ?? r.rate_type.replace("_", " ")}</div>
          {r.is_default && <span className="text-xs text-muted-foreground">Default</span>}
        </div>
      ),
    },
    {
      id: "scope",
      header: "Scope",
      cell: (r: TeamMemberRate) => rateScopeLabel(r, projectMap.get(r.project_id ?? "") ?? null),
    },
    {
      id: "type",
      header: "Type",
      cell: (r: TeamMemberRate) => r.rate_type.replace("_", " "),
    },
    {
      id: "amount",
      header: "Native rate",
      cell: (r: TeamMemberRate) => (
        <span className="font-serif text-sm font-semibold tabular-nums">{formatRate(r)}</span>
      ),
    },
    {
      id: "project",
      header: "Project",
      cell: (r: TeamMemberRate) =>
        r.project_id ? (projectMap.get(r.project_id) ?? r.project_id.slice(0, 8)) : "—",
    },
    {
      id: "work_type",
      header: "Work type",
      cell: (r: TeamMemberRate) => r.work_type ?? "—",
    },
    {
      id: "dates",
      header: "Effective",
      cell: (r: TeamMemberRate) =>
        `${r.effective_from}${r.effective_to ? ` → ${r.effective_to}` : ""}`,
    },
    {
      id: "status",
      header: "Status",
      cell: (r: TeamMemberRate) => <RateStatusBadge status={r.status} />,    },
    ...(canManage
      ? [{
          id: "actions",
          header: "",
          cell: (r: TeamMemberRate) => (
            <RateActions
              rate={r}
              personId={person.id}
              onEdit={() => openEdit(r)}
              onDuplicate={() => {
                setEditRate(r);
                setDialogMode("duplicate");
                setDialogOpen(true);
              }}
              onReplace={() => {
                setEditRate(r);
                setDialogMode("replace");
                setDialogOpen(true);
              }}
              onEnd={() => void handleEnd(r)}
              onSetDefault={() => void handleSetDefault(r)}
              onDelete={() => void handleDelete(r)}
            />
          ),
        }]
      : []),
  ];

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Compensation rates are restricted to admins.</p>;
  }

  return (
    <div className="space-y-4">
      <TeamPanelHeader
        title="Rates"
        action={
          <TeamOutlineButton onClick={openCreate}>
            <Plus className={teamIcon} /> Add rate
          </TeamOutlineButton>
        }
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <TeamMiniStat
          label="Default rate"
          value={defaultRate ? formatRate(defaultRate) : "—"}
        />
        <TeamMiniStat label="Active rates" value={String(activeRates.length)} />
        <TeamMiniStat
          label="Scheduled"
          value={String(scheduledRates.length)}
        />
        {scheduledRates.length > 0 && (
          <TeamMiniStat
            label="Next change"
            value={scheduledRates[0]?.effective_from ?? "—"}
          />
        )}
      </div>

      {defaultRate && (
        <p className="text-xs text-muted-foreground">{formatRateDescription(defaultRate)}</p>
      )}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading rates…</p>
      ) : rates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rates recorded yet.</p>
      ) : (
        <>
          <DataTable
            tableId={`team-rates-active-${person.id}`}
            data={activeRates.concat(scheduledRates)}
            columns={columns}
            enablePagination={false}
          />

          {historicalRates.length > 0 && (
            <div className="space-y-2">
        <Button size="sm" variant="ghost" className={cn("gap-1 text-muted-foreground", teamActionBtn.secondary)} onClick={() => setShowHistory((v) => !v)}>
                <History className={teamIcon} />
                {showHistory ? "Hide" : "Show"} historical rates ({historicalRates.length})
                <ChevronDown className={cn(teamIcon, "transition-transform", showHistory && "rotate-180")} />
              </Button>              {showHistory && (
                <DataTable
                  tableId={`team-rates-history-${person.id}`}
                  data={historicalRates}
                  columns={columns}
                  enablePagination={false}
                />
              )}
            </div>
          )}
        </>
      )}

      <RateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        person={person}
        rate={editRate}
        mode={dialogMode}
      />
    </div>
  );
}

function RateActions({
  rate,
  personId,
  onEdit,
  onDuplicate,
  onReplace,
  onEnd,
  onSetDefault,
  onDelete,
}: {
  rate: TeamMemberRate;
  personId: string;
  onEdit: () => void;
  onDuplicate: () => void;
  onReplace: () => void;
  onEnd: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const { data: usage } = useRateUsageCheck(rate.id, { enabled: !!rate.id });
  const isUsed = usage?.is_used ?? false;
  const canEdit = !isUsed && rate.status !== "expired";
  const canDelete = !isUsed && rate.status !== "active";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className={teamActionBtn.menu}>
          <MoreHorizontal className={teamIcon} />
        </Button>      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit && <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>}
        <DropdownMenuItem onClick={onDuplicate}>Duplicate</DropdownMenuItem>
        {rate.status === "active" && (
          <DropdownMenuItem onClick={onReplace}>
            {isUsed ? "Schedule replacement" : "Replace rate"}
          </DropdownMenuItem>
        )}
        {rate.status === "active" && !rate.effective_to && (
          <DropdownMenuItem onClick={onEnd}>End rate</DropdownMenuItem>
        )}
        {!rate.project_id && !rate.work_type && !rate.is_default && rate.status === "active" && (
          <DropdownMenuItem onClick={onSetDefault}>Set as default</DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
