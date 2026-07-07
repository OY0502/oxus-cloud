import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ExpandableTextProps {
  text: string | null | undefined;
  maxLines?: number;
  emptyLabel?: string;
  className?: string;
}

export function ExpandableText({
  text,
  maxLines = 4,
  emptyLabel = "Not captured yet.",
  className,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text?.trim() ?? "";

  if (!trimmed) {
    return <p className={cn("text-sm text-cool-slate italic", className)}>{emptyLabel}</p>;
  }

  const lineCount = trimmed.split(/\r?\n/).length;
  const charThreshold = maxLines * 90;
  const isLong = lineCount > maxLines || trimmed.length > charThreshold;

  if (!isLong) {
    return <p className={cn("text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap", className)}>{trimmed}</p>;
  }

  const preview = expanded
    ? trimmed
    : trimmed
        .split(/\r?\n/)
        .slice(0, maxLines)
        .join("\n")
        .slice(0, charThreshold)
        .trim() + (trimmed.length > charThreshold || lineCount > maxLines ? "…" : "");

  return (
    <div className={className}>
      <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{preview}</p>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 h-7 px-2 text-xs text-periwinkle"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Show less" : "Show more"}
      </Button>
    </div>
  );
}
