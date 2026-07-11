import React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface EntityDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function EntityDrawer({
  open,
  onOpenChange,
  title,
  description,
  headerActions,
  children,
  className,
}: EntityDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(
          "flex w-[92vw] min-w-0 flex-col gap-0 overflow-hidden border-l-border/50 bg-background/95 p-0 backdrop-blur-xl sm:max-w-2xl",
          className,
        )}
      >
        <SheetHeader className="shrink-0 space-y-0 border-b border-border/50 px-6 pb-4 pt-5 pr-14">
          <div className="space-y-3">
            <SheetTitle className="text-left text-base font-normal leading-snug">{title}</SheetTitle>
            {description && <SheetDescription className="mt-0 text-sm">{description}</SheetDescription>}
            {headerActions && (
              <div className="flex flex-wrap items-center gap-2">
                {headerActions}
              </div>
            )}
          </div>
        </SheetHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-4">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
