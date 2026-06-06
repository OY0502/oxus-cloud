import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: React.ReactNode;
  trend?: {
    value: number | string;
    label: string;
    positive?: boolean;
  };
  icon?: React.ReactNode;
  chart?: React.ReactNode;
  className?: string;
  valueClassName?: string;
}

export function MetricCard({ title, value, trend, icon, chart, className, valueClassName }: MetricCardProps) {
  return (
    <Card className={cn("hover-elevate bg-card", className)}>
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          {icon && <div className="text-muted-foreground/50">{icon}</div>}
        </div>
        
        <div className="mt-2">
          <div className={cn("text-3xl font-bold font-sans", valueClassName)}>
            {value}
          </div>
          
          {trend && (
            <p className="text-xs mt-2 flex items-center gap-1">
              <span className={cn(
                "font-medium", 
                trend.positive === true ? "text-soft-green" : 
                trend.positive === false ? "text-soft-red" : "text-muted-foreground"
              )}>
                {trend.value}
              </span>
              <span className="text-muted-foreground">{trend.label}</span>
            </p>
          )}
          
          {chart && (
            <div className="mt-4 h-12 w-full">
              {chart}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
