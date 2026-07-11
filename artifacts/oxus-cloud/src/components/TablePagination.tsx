import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TablePaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function TablePagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  className,
}: TablePaginationProps) {
  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-border/60 bg-muted/20 px-4 py-2.5 text-sm",
        className,
      )}
    >
      <span className="text-muted-foreground tabular-nums">
        {start}–{end} of {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2.5"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2.5"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
