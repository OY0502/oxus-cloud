import React from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type CrmRecordDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  header: React.ReactNode;
  actions?: React.ReactNode;
  summary?: React.ReactNode;
  tabs?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function CrmRecordDrawer({
  open,
  onOpenChange,
  header,
  actions,
  summary,
  tabs,
  footer,
  children,
  className,
}: CrmRecordDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(
          "flex w-full min-w-0 flex-col gap-0 overflow-hidden border-l-border/50 bg-background p-0 sm:max-w-[650px]",
          className,
        )}
      >
        <div className="shrink-0 border-b border-border/50 bg-background/95 backdrop-blur-sm">
          <div className="space-y-3 px-5 pb-3 pt-5 pr-12">
            {header}
            {actions}
            {summary}
          </div>
          {tabs && (
            <div className="border-t border-border/40 px-5 pb-0 pt-2">
              {tabs}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4">
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-border/50 bg-background/95 px-5 py-3 backdrop-blur-sm">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
