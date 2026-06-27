import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { MoreHorizontal, Clock, AlertCircle } from "lucide-react";
import { formatEUR } from "@/lib/currency";

export interface DealCardData {
  id: string;
  company: string;
  contact: string;
  projectType: string;
  budget: number;
  pocName: string;
  avatarUrl?: string | null;
  ageInStage: number;
  nextAction: string;
  tags: string[];
  urgency: string;
}

interface DealCardProps {
  item: DealCardData;
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function DealCard({ item, className }: DealCardProps) {
  return (
    <Card className={`mb-4 border-border/50 bg-card/80 backdrop-blur-sm shadow-sm group hover-elevate ${className || ""}`}>
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center font-serif font-bold text-muted-foreground text-xs">
              {item.company.charAt(0)}
            </div>
            <div>
              <h4 className="font-semibold text-sm text-foreground line-clamp-1">{item.company}</h4>
              <p className="text-xs text-muted-foreground">{item.projectType}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {item.urgency === "high" && <AlertCircle className="w-3.5 h-3.5 text-soft-red" />}
            <button className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        <div className="flex justify-between items-center mb-4">
          <span className="text-lg font-bold font-sans tracking-tight text-foreground">
            {formatEUR(item.budget)}
          </span>
          <Avatar className="w-7 h-7 border-2 border-background" title={item.pocName || undefined}>
            {item.avatarUrl && <AvatarImage src={item.avatarUrl} />}
            <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
              {initials(item.pocName)}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {item.tags.map((tag: string) => (
            <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 bg-background/50 text-muted-foreground border-border/50">
              {tag}
            </Badge>
          ))}
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-border/50 text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> {item.ageInStage}d in stage
          </span>
          <span className="text-primary font-medium">{item.nextAction}</span>
        </div>
      </CardContent>
    </Card>
  );
}
