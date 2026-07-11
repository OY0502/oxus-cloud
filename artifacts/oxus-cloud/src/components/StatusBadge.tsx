import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusVariant =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "default"
  | "neutral";

interface StatusBadgeProps {
  status: string;
  variant?: StatusVariant;
  className?: string;
}

const variantStyles: Record<StatusVariant, string> = {
  success: "bg-success-muted text-success border-success/25",
  warning: "bg-warning-muted text-warning border-warning/25",
  danger: "bg-danger-muted text-danger border-danger/25",
  info: "bg-info-muted text-info border-info/25",
  default: "bg-primary/8 text-primary border-primary/15",
  neutral: "bg-neutral-badge text-neutral-badge-foreground border-border/80",
};

export function StatusBadge({ status, variant, className }: StatusBadgeProps) {
  const detectedVariant = variant || (
    status.toLowerCase().includes("paid") || status.toLowerCase().includes("won") || status.toLowerCase().includes("completed") || status.toLowerCase().includes("active") || status.toLowerCase().includes("accepted") || status.toLowerCase().includes("synced") ? "success" :
    status.toLowerCase().includes("pending") || status.toLowerCase().includes("progress") || status.toLowerCase().includes("scoping") ? "warning" :
    status.toLowerCase().includes("overdue") || status.toLowerCase().includes("declined") || status.toLowerCase().includes("risk") || status.toLowerCase().includes("inactive") || status.toLowerCase().includes("failed") ? "danger" :
    status.toLowerCase().includes("new") || status.toLowerCase().includes("proposal") || status.toLowerCase().includes("sent") || status.toLowerCase().includes("viewed") ? "info" :
    "neutral"
  );

  return (
    <Badge
      variant="outline"
      className={cn("status-chip", variantStyles[detectedVariant], className)}
    >
      {status}
    </Badge>
  );
}
