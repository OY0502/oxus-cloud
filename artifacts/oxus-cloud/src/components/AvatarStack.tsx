import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface AvatarStackProps {
  urls: string[];
  /** Optional initials shown when a url is empty (same order as urls). */
  fallbacks?: string[];
  max?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "w-6 h-6 border-2",
  md: "w-8 h-8 border-2",
  lg: "w-10 h-10 border-[3px]"
};

export function AvatarStack({ urls, fallbacks = [], max = 3, size = "md", className }: AvatarStackProps) {
  const visible = urls.slice(0, max);
  const remaining = urls.length - max;

  return (
    <div className={cn("flex items-center -space-x-2", className)}>
      {visible.map((url, i) => (
        <Avatar key={i} className={cn("border-background", sizeClasses[size])}>
          {url ? <AvatarImage src={url} /> : null}
          <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
            {fallbacks[i] ?? "?"}
          </AvatarFallback>
        </Avatar>
      ))}
      
      {remaining > 0 && (
        <Avatar className={cn("border-background bg-muted text-muted-foreground", sizeClasses[size])}>
          <AvatarFallback className="text-xs font-medium">+{remaining}</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
