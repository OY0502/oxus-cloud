import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Consistent action button sizes for Team page + drawer */
export const teamActionBtn = {
  primary: "h-9 gap-1.5 px-3 text-sm",
  secondary: "h-9 gap-1.5 px-3 text-sm",
  tertiary: "h-8 w-8",
  menu: "h-8 w-8",
} as const;

export const teamIcon = "h-4 w-4 shrink-0";

export function TeamPanelSection({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border/60 bg-card/40", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
        <h4 className="section-label normal-case tracking-wide text-xs">{title}</h4>
        {action}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function TeamPanelHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="section-label normal-case tracking-wide text-xs">{title}</h3>
      {action}
    </div>
  );
}

export function TeamDetailGrid({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{children}</dl>
  );
}

export function TeamDetailItem({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

export function TeamMiniStat({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border border-border/50 bg-muted/20 px-3 py-2",
        className,
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-serif text-sm font-semibold tabular-nums tracking-tight">
        {value}
      </div>
    </div>
  );
}

export function TeamInactiveBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 border-l-4 border-l-muted-foreground/40 bg-muted/35 px-3 py-2.5 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function TeamChip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function TeamOutlineButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(teamActionBtn.secondary, className)}
      {...props}
    />
  );
}

export function TeamPrimaryButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button size="sm" className={cn(teamActionBtn.primary, className)} {...props} />
  );
}

export function TeamIconButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="icon"
      className={cn(teamActionBtn.tertiary, className)}
      {...props}
    />
  );
}

export function teamTableRowClass(inactive: boolean): string | undefined {
  if (!inactive) return undefined;
  return "bg-muted/30 hover:bg-muted/40 [&_td]:text-muted-foreground";
}
