import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Consistent action button sizes for Team page + drawer */
export const teamActionBtn = {
  primary: "h-9 gap-1.5 px-3 text-sm",
  secondary: "h-9 gap-1.5 px-3 text-sm",
  tertiary: "h-9 w-9",
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
    <section className={cn("rounded-xl border border-border/70 bg-card shadow-sm", className)}>
      <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-4">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
        {action}
      </div>
      <div className="px-4 pb-4 pt-2">{children}</div>
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
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
      {action}
    </div>
  );
}

export function TeamDetailGrid({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">{children}</dl>
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
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium leading-snug text-foreground">{children}</dd>
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
        "min-w-0 rounded-lg bg-muted/55 px-3 py-2.5",
        className,
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold tabular-nums tracking-tight text-foreground">
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

export function TeamRecordList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card", className)}>
      {children}
    </div>
  );
}

export function TeamRecordItem({
  title,
  subtitle,
  trailing,
  details,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  details?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <article className={cn("min-w-0 px-4 py-3.5", className)}>
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-snug text-foreground">
            {title}
          </div>
          {subtitle && (
            <div className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
        {trailing && <div className="shrink-0 text-right">{trailing}</div>}
      </div>

      {(details || actions) && (
        <div className="mt-3 flex min-w-0 flex-wrap items-end justify-between gap-3">
          {details && (
            <div className="grid min-w-[240px] flex-1 grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3">
              {details}
            </div>
          )}
          {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      )}
    </article>
  );
}

export function TeamRecordField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-xs font-medium leading-snug text-foreground">{children}</div>
    </div>
  );
}

export function TeamEmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-8 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>}
    </div>
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
