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
  success: "bg-soft-green/15 text-soft-green border-soft-green/30",
  warning: "bg-warm-yellow/15 text-warm-yellow border-warm-yellow/30",
  danger: "bg-soft-red/15 text-soft-red border-soft-red/30",
  info: "bg-logo-blue/20 text-primary border-logo-blue/40",
  default: "bg-primary/10 text-primary border-primary/20",
  neutral: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, variant, className }: StatusBadgeProps) {
  // Auto-detect variant based on common status strings if not provided
  const detectedVariant = variant || (
    status.toLowerCase().includes("paid") || status.toLowerCase().includes("won") || status.toLowerCase().includes("completed") || status.toLowerCase().includes("active") || status.toLowerCase().includes("accepted") ? "success" :
    status.toLowerCase().includes("pending") || status.toLowerCase().includes("progress") || status.toLowerCase().includes("scoping") ? "warning" :
    status.toLowerCase().includes("overdue") || status.toLowerCase().includes("declined") || status.toLowerCase().includes("risk") || status.toLowerCase().includes("inactive") ? "danger" :
    status.toLowerCase().includes("new") || status.toLowerCase().includes("proposal") || status.toLowerCase().includes("sent") ? "info" :
    "neutral"
  );

  return (
    <Badge 
      variant="outline" 
      className={cn(
        "font-medium px-2 py-0.5 capitalize-first tracking-wide shadow-none",
        variantStyles[detectedVariant],
        className
      )}
    >
      {status}
    </Badge>
  );
}
