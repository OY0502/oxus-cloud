import React, { useState } from "react";
import { formatCurrency } from "@/lib/currency";
import type { EurReportingAggregate } from "@/lib/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export function EurReportingValue({
  aggregate,
  fallback,
  className,
}: {
  aggregate: EurReportingAggregate | null | undefined;
  fallback?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!aggregate) {
    return <span className={className}>{fallback ?? "—"}</span>;
  }

  const display =
    aggregate.total_eur != null
      ? formatCurrency(aggregate.total_eur, "EUR")
      : "Not available";

  if (aggregate.breakdown.length <= 1 && !aggregate.has_unconverted) {
    return <span className={className}>{display}</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="link" className={`h-auto p-0 font-semibold ${className ?? ""}`}>
          {display}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm" align="start">
        <p className="font-medium mb-2">EUR reporting breakdown</p>
        <ul className="space-y-1.5 text-muted-foreground">
          {aggregate.breakdown.map((line) => (
            <li key={line.currency}>
              {formatCurrency(line.native_amount, line.currency)} native
              {line.amount_eur != null ? (
                <>
                  {" → "}
                  {formatCurrency(line.amount_eur, "EUR")}
                  {line.fx_rate_to_eur != null && line.fx_rate_date && (
                    <span className="block text-xs">
                      ECB rate {line.fx_rate_to_eur.toFixed(4)} on {line.fx_rate_date}
                    </span>
                  )}
                </>
              ) : (
                <span className="block text-xs text-amber-600">EUR conversion unavailable</span>
              )}
            </li>
          ))}
        </ul>
        {aggregate.has_unconverted && (
          <p className="mt-2 text-xs text-amber-600">
            Total excludes amounts where EUR conversion was unavailable.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
