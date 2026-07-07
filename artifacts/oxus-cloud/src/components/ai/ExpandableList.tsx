import React, { useState } from "react";
import { Button } from "@/components/ui/button";

interface ExpandableListProps<T> {
  items: T[];
  initialCount?: number;
  emptyLabel?: string;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
}

export function ExpandableList<T>({
  items,
  initialCount = 5,
  emptyLabel = "None captured yet.",
  renderItem,
  className,
}: ExpandableListProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = items.length > initialCount;
  const visible = expanded ? items : items.slice(0, initialCount);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className={className}>
      <div className="space-y-2">{visible.map((item, index) => renderItem(item, index))}</div>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 px-2 text-xs text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}
