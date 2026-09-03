import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useManageTeamMemberRate,
  useRateUsageCheck,
  useTeamMemberRates,
} from "@/hooks/api";
import { formatRate } from "@/lib/team";
import {
  formatRateDescription,
  getDefaultRate,
  rateAppliesToLabel,
  rateHasProjects,
  rateScopeLabel,
  rateStatusVariant,
} from "@/lib/teamMemberRates";
import type { Contact, TeamMemberRate } from "@/lib/types";
import { RateDialog } from "./TeamDialogs";
import { ChevronDown, History, MoreHorizontal, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  TeamEmptyState,
  TeamMiniStat,
  TeamOutlineButton,
  TeamPanelHeader,
  TeamRecordField,
  TeamRecordItem,
  TeamRecordList,
  teamActionBtn,
  teamIcon,
} from "./teamUi";
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
  const manageRate = useManageTeamMemberRate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRate, setEditRate] = useState<TeamMemberRate | null>(null);
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | "duplicate" | "replace">("create");
  const [showHistory, setShowHistory] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const defaultRate = getDefaultRate(rates, today);
  const activeRates = rates.filter((rate) => rate.status === "active");
  const scheduledRates = rates.filter((rate) => rate.status === "scheduled");
  const historicalRates = rates.filter((rate) => rate.status === "expired");

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
    } catch (error) {
      toast({
        title: "Could not end rate",
        description: error instanceof Error ? error.message : "Try again.",
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
    } catch (error) {
      toast({
        title: "Could not set default",
        description: error instanceof Error ? error.message : "Try again.",
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
    } catch (error) {
      toast({
        title: "Could not delete rate",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const renderRate = (rate: TeamMemberRate) => {
    const scope = rateScopeLabel(rate);
    const appliesTo = rateAppliesToLabel(rate).replace(/\n/g, ", ");

    return (
      <TeamRecordItem
        key={rate.id}
        title={
          <>
            <span>{rate.name ?? rate.rate_type.replace("_", " ")}</span>
            {rate.is_default && <StatusBadge status="Default" variant="neutral" />}
            <RateStatusBadge status={rate.status} />
          </>
        }
        subtitle={[scope, appliesTo].filter((value, index, all) => value && all.indexOf(value) === index).join(" · ")}
        trailing={
          <>
            <div className="text-xs text-muted-foreground">Rate</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{formatRate(rate)}</div>
          </>
        }
        details={
          <>
            <TeamRecordField label="Type">{rate.rate_type.replace("_", " ")}</TeamRecordField>
            <TeamRecordField label="Effective">
              {rate.effective_from}{rate.effective_to ? ` → ${rate.effective_to}` : " → ongoing"}
            </TeamRecordField>
          </>
        }
        actions={canManage ? (
          <RateActions
            rate={rate}
            onEdit={() => openEdit(rate)}
            onDuplicate={() => {
              setEditRate(rate);
              setDialogMode("duplicate");
              setDialogOpen(true);
            }}
            onReplace={() => {
              setEditRate(rate);
              setDialogMode("replace");
              setDialogOpen(true);
            }}
            onEnd={() => void handleEnd(rate)}
            onSetDefault={() => void handleSetDefault(rate)}
            onDelete={() => void handleDelete(rate)}
          />
        ) : undefined}
      />
    );
  };

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Compensation rates are restricted to admins.</p>;
  }

  const currentRates = activeRates.concat(scheduledRates);

  return (
    <div className="space-y-4">
      <TeamPanelHeader
        title="Compensation rates"
        action={
          <TeamOutlineButton onClick={openCreate}>
            <Plus className={teamIcon} /> Add rate
          </TeamOutlineButton>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TeamMiniStat label="Default rate" value={defaultRate ? formatRate(defaultRate) : "—"} />
        <TeamMiniStat label="Active" value={String(activeRates.length)} />
        <TeamMiniStat label="Scheduled" value={String(scheduledRates.length)} />
        <TeamMiniStat label="Next change" value={scheduledRates[0]?.effective_from ?? "—"} />
      </div>

      {defaultRate && <p className="text-xs text-muted-foreground">{formatRateDescription(defaultRate)}</p>}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading rates…</p>
      ) : currentRates.length === 0 ? (
        <TeamEmptyState title="No active rates" description="Add a rate to define this member's compensation." />
      ) : (
        <TeamRecordList>{currentRates.map(renderRate)}</TeamRecordList>
      )}

      {historicalRates.length > 0 && (
        <div className="space-y-2">
          <Button
            size="sm"
            variant="ghost"
            className={cn("gap-1 text-muted-foreground", teamActionBtn.secondary)}
            onClick={() => setShowHistory((value) => !value)}
          >
            <History className={teamIcon} />
            {showHistory ? "Hide" : "Show"} history ({historicalRates.length})
            <ChevronDown className={cn(teamIcon, "transition-transform", showHistory && "rotate-180")} />
          </Button>
          {showHistory && <TeamRecordList>{historicalRates.map(renderRate)}</TeamRecordList>}
        </div>
      )}

      {dialogOpen && (
        <RateDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          person={person}
          rate={editRate}
          mode={dialogMode}
        />
      )}
    </div>
  );
}

function RateActions({
  rate,
  onEdit,
  onDuplicate,
  onReplace,
  onEnd,
  onSetDefault,
  onDelete,
}: {
  rate: TeamMemberRate;
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
        <Button variant="ghost" size="icon" className={teamActionBtn.menu} aria-label="Rate actions">
          <MoreHorizontal className={teamIcon} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit && <DropdownMenuItem onSelect={onEdit}>Edit rate</DropdownMenuItem>}
        <DropdownMenuItem onSelect={onDuplicate}>Duplicate rate</DropdownMenuItem>
        {rate.status === "active" && (
          <DropdownMenuItem onSelect={onReplace}>
            {isUsed ? "Schedule replacement" : "Replace rate"}
          </DropdownMenuItem>
        )}
        {rate.status === "active" && !rate.effective_to && (
          <DropdownMenuItem onSelect={onEnd}>End rate</DropdownMenuItem>
        )}
        {!rateHasProjects(rate) && !rate.work_type && !rate.is_default && rate.status === "active" && (
          <DropdownMenuItem onSelect={onSetDefault}>Set as default</DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
              Delete rate
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
