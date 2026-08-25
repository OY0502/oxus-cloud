import React from "react";
import { MetricCard } from "@/components/MetricCard";
import { Building2, Users, UserCheck, Inbox } from "lucide-react";

type Props = {
  peopleCount: number;
  companiesCount: number;
  activeClientsCount: number;
  needsReviewCount: number;
  secondaryLine?: string;
  onPeopleClick: () => void;
  onCompaniesClick: () => void;
  onActiveClientsClick: () => void;
  onNeedsReviewClick: () => void;
};

export function CrmKpiStrip({
  peopleCount,
  companiesCount,
  activeClientsCount,
  needsReviewCount,
  secondaryLine,
  onPeopleClick,
  onCompaniesClick,
  onActiveClientsClick,
  onNeedsReviewClick,
}: Props) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard compact title="People" value={String(peopleCount)} icon={<Users className="w-4 h-4" />} onClick={onPeopleClick} />
        <MetricCard compact title="Companies" value={String(companiesCount)} icon={<Building2 className="w-4 h-4" />} onClick={onCompaniesClick} />
        <MetricCard compact title="Active clients" value={String(activeClientsCount)} icon={<UserCheck className="w-4 h-4" />} onClick={onActiveClientsClick} />
        <MetricCard compact title="Needs review" value={String(needsReviewCount)} icon={<Inbox className="w-4 h-4" />} onClick={onNeedsReviewClick} />
      </div>
      {secondaryLine && (
        <p className="text-xs text-muted-foreground">{secondaryLine}</p>
      )}
    </div>
  );
}
