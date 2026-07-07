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
import { useConvertQuoteToProject, useEnrichProjectFromWebsite } from "@/hooks/api";
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
  const enrichFromWebsite = useEnrichProjectFromWebsite();

  const confirm = async () => {
    if (!quote) return;
    try {
      const project = await convert.mutateAsync(quote);

      // Kick off enrichment + initial Project Intelligence from the proposal's
      // company website + request message. Fire-and-forget: never block conversion.
      const website = quote.company_website_url?.trim() || null;
      const requestMessage = quote.request_message?.trim() || null;
      if (website || requestMessage) {
        enrichFromWebsite
          .mutateAsync({
            project_id: project.id,
            company_website_url: website,
            request_message: requestMessage,
            proposal_id: quote.id,
          })
          .then((r) => {
            toast({
              title: r.async ? "Project intelligence queued" : "Project intelligence started",
              description: website
                ? "Enriching from the company website and the client's request message."
                : "Initializing project intelligence from the client's request message.",
            });
          })
          .catch((e) => console.warn("[enrichment] convert queue failed", (e as Error).message));
      }

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
