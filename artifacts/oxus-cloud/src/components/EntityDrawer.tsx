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
  className 
}: EntityDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={cn("sm:max-w-xl w-[90vw] overflow-y-auto bg-background/95 backdrop-blur-xl border-l-border/50", className)}>
        <SheetHeader className="pb-6 border-b border-border/50">
          <div className="flex justify-between items-start gap-4 pr-10">
            <div>
              <SheetTitle className="text-2xl font-serif">{title}</SheetTitle>
              {description && <SheetDescription className="mt-1.5">{description}</SheetDescription>}
            </div>
            {headerActions && (
              <div className="shrink-0 flex items-center gap-2">
                {headerActions}
              </div>
            )}
          </div>
        </SheetHeader>
        
        <div className="mt-6">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
