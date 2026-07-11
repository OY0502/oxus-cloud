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
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  chart?: React.ReactNode;
  className?: string;
  valueClassName?: string;
  onClick?: () => void;
}

export function MetricCard({ title, value, trend, subtitle, icon, chart, className, valueClassName, onClick }: MetricCardProps) {
  const interactive = typeof onClick === "function";
  return (
    <Card
      className={cn(
        "hover-elevate border-card-border",
        interactive && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={onClick}
      onKeyDown={interactive ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      } : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-sm font-medium text-cool-slate">{title}</h3>
          {icon && <div className="text-cool-slate/60">{icon}</div>}
        </div>
        
        <div className="mt-2">
          <div className={cn("kpi-value", valueClassName)}>
            {value}
          </div>
          
          {trend && (
            <p className="text-xs mt-2 flex items-center gap-1">
              <span className={cn(
                "font-medium", 
                trend.positive === true ? "text-success" : 
                trend.positive === false ? "text-danger" : "text-cool-slate"
              )}>
                {trend.value}
              </span>
              <span className="text-cool-slate">{trend.label}</span>
            </p>
          )}

          {subtitle && (
            <p className="text-xs mt-2 text-cool-slate">{subtitle}</p>
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
