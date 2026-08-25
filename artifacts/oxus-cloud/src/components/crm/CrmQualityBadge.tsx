import React from "react";
import { Badge } from "@/components/ui/badge";

const QUALITY_LABELS: Record<string, string> = {
  accepted: "Verified",
  needs_review: "Needs review",
  suppressed: "Suppressed",
  ignored: "Ignored",
};

const QUALITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  accepted: "secondary",
  needs_review: "outline",
  suppressed: "destructive",
  ignored: "secondary",
};

export function CrmQualityBadge({ status }: { status?: string | null }) {
  if (!status || status === "accepted") return null;
  return (
    <Badge variant={QUALITY_VARIANT[status] ?? "outline"} className="text-[10px] font-normal">
      {QUALITY_LABELS[status] ?? status}
    </Badge>
  );
}
