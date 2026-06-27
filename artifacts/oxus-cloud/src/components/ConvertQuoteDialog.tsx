import React from "react";
import { useLocation } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useConvertQuoteToProject } from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import type { QuoteWithRefs } from "@/lib/types";

interface ConvertQuoteDialogProps {
  quote: QuoteWithRefs | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the user declines (or after navigation) to clean up state. */
  onDone?: () => void;
}

export function ConvertQuoteDialog({ quote, open, onOpenChange, onDone }: ConvertQuoteDialogProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const convert = useConvertQuoteToProject();

  const confirm = async () => {
    if (!quote) return;
    try {
      const project = await convert.mutateAsync(quote);
      onOpenChange(false);
      onDone?.();
      navigate(`/projects/${project.id}`);
    } catch (e) {
      toast({ title: "Couldn't create project", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) onDone?.(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Create a project from this quote?</AlertDialogTitle>
          <AlertDialogDescription>
            This quote was marked as Won. Create a project pre-filled with its details so you can start delivery. You can keep it as a draft and finish setup later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={convert.isPending}>
            {convert.isPending ? "Creating…" : "Create project"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
