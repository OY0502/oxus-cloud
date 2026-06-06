import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface InvoicePaperCardProps {
  invoice: any;
  onClick?: () => void;
}

export function InvoicePaperCard({ invoice, onClick }: InvoicePaperCardProps) {
  const isOverdue = invoice.status === 'overdue';
  const isPaid = invoice.status === 'paid';
  
  return (
    <Card 
      onClick={onClick}
      className={cn(
        "cursor-pointer transition-all duration-300 group relative paper hover:-translate-y-2 hover:-rotate-1 z-10 hover:z-20",
        isOverdue ? "border-t-4 border-t-soft-red" : 
        isPaid ? "border-t-4 border-t-soft-green" : 
        "border-t-4 border-t-warm-yellow"
      )}
      style={{
        transform: onClick ? `rotate(${Math.random() * 2 - 1}deg)` : 'none'
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent dark:from-white/5 dark:to-transparent z-0 pointer-events-none" />
      
      <CardContent className="p-6 relative z-10 flex flex-col h-full">
        <div className="flex justify-between items-start mb-6">
          {isPaid ? (
            <div className="flex items-center text-soft-green text-sm font-bold tracking-wider uppercase border-2 border-soft-green/30 px-2 py-1 rounded opacity-80 rotate-[-5deg]">
              <CheckCircle2 className="w-4 h-4 mr-1" /> PAID
            </div>
          ) : isOverdue ? (
            <div className="text-soft-red text-sm font-bold tracking-widest uppercase border-2 border-soft-red/40 px-3 py-1 rounded opacity-90 rotate-[-12deg] shadow-sm bg-soft-red/5 inline-block">
              OVERDUE
            </div>
          ) : (
            <div className="text-warm-yellow text-sm font-bold tracking-wider uppercase border border-warm-yellow/50 px-2 py-1 rounded opacity-80">
              PENDING
            </div>
          )}
          <span className="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded">{invoice.number}</span>
        </div>
        
        <div className="flex-1 mt-2">
          <h4 className="text-3xl font-serif font-bold text-foreground">${invoice.amount.toLocaleString()}</h4>
          <p className="text-sm font-medium mt-2 text-muted-foreground">{invoice.client}</p>
        </div>
        
        <div className="mt-8 pt-4 border-t border-dashed border-border flex justify-between items-center text-xs text-muted-foreground">
          <span>Due: <strong className={cn(isOverdue && "text-soft-red")}>{invoice.dueDate}</strong></span>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center text-primary font-medium">
            Review <ArrowUpRight className="w-3 h-3 ml-1" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
