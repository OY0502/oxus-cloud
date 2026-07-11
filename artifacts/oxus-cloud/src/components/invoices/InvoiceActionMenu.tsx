import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  type Invoice,
  type InvoiceAction,
  type StripeInvoiceActionType,
  stripeDashboardUrl,
  getAssignProjectLabel,
} from "@/lib/invoices";
import {
  AlertTriangle,
  Ban,
  Briefcase,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  MoreHorizontal,
  Send,
  Trash2,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const ACTION_ICONS: Record<string, LucideIcon> = {
  view: Eye,
  assign_project: Briefcase,
  copy_link: Copy,
  download_pdf: Download,
  open_stripe: ExternalLink,
  view_invoice: ExternalLink,
  finalize: CheckCircle2,
  send: Send,
  mark_paid_out_of_band: Wallet,
  void: Ban,
  mark_uncollectible: AlertTriangle,
  delete_draft: Trash2,
};

function actionIcon(action: InvoiceAction): LucideIcon {
  if (action.stripeAction) return ACTION_ICONS[action.stripeAction] ?? Send;
  return ACTION_ICONS[action.id] ?? Eye;
}

function actionLabel(action: InvoiceAction, invoice: Invoice): string {
  if (action.id === "assign_project") return getAssignProjectLabel(invoice);
  return action.label;
}

export interface InvoiceActionMenuHandlers {
  onView?: (invoice: Invoice) => void;
  onAssignProject?: (invoice: Invoice) => void;
  onCopyLink?: (invoice: Invoice) => void;
  onStripeAction?: (invoice: Invoice, action: StripeInvoiceActionType) => void;
}

interface InvoiceActionMenuProps {
  invoice: Invoice;
  actions: InvoiceAction[];
  handlers: InvoiceActionMenuHandlers;
  /** Row trigger uses icon button; drawer/footer uses labeled button */
  trigger?: "icon" | "button";
  triggerLabel?: string;
  align?: "start" | "center" | "end";
}

export function InvoiceActionMenu({
  invoice,
  actions,
  handlers,
  trigger = "icon",
  triggerLabel = "More actions",
  align = "end",
}: InvoiceActionMenuProps) {
  if (actions.length === 0) return null;

  const nonDestructive = actions.filter((a) => !a.destructive);
  const destructive = actions.filter((a) => a.destructive);
  const browseIds = new Set(["view", "assign_project", "copy_link", "download_pdf", "open_stripe", "view_invoice"]);
  const browse = nonDestructive.filter((a) => browseIds.has(a.id));
  const mutations = nonDestructive.filter((a) => !browseIds.has(a.id));
  const stripeUrl = stripeDashboardUrl(invoice);

  const renderItem = (action: InvoiceAction) => {
    const Icon = actionIcon(action);
    const label = actionLabel(action, invoice);
    const iconEl = <Icon className="mr-2 h-4 w-4 shrink-0" aria-hidden />;

    if (action.id === "view") {
      return (
        <DropdownMenuItem key={action.id} onClick={() => handlers.onView?.(invoice)}>
          {iconEl}
          {label}
        </DropdownMenuItem>
      );
    }
    if (action.id === "assign_project") {
      return (
        <DropdownMenuItem key={action.id} onClick={() => handlers.onAssignProject?.(invoice)}>
          {iconEl}
          {label}
        </DropdownMenuItem>
      );
    }
    if (action.id === "copy_link") {
      return (
        <DropdownMenuItem
          key={action.id}
          disabled={action.disabled}
          onClick={() => handlers.onCopyLink?.(invoice)}
        >
          {iconEl}
          {label}
        </DropdownMenuItem>
      );
    }
    if (action.id === "download_pdf" && invoice.hostedInvoiceUrl) {
      return (
        <DropdownMenuItem key={action.id} asChild>
          <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">
            {iconEl}
            {label}
          </a>
        </DropdownMenuItem>
      );
    }
    if (action.id === "download_pdf") {
      return (
        <DropdownMenuItem key={action.id} disabled>
          {iconEl}
          {label}
        </DropdownMenuItem>
      );
    }
    if (action.id === "open_stripe" && stripeUrl) {
      return (
        <DropdownMenuItem key={action.id} asChild>
          <a href={stripeUrl} target="_blank" rel="noopener noreferrer">
            {iconEl}
            {label}
          </a>
        </DropdownMenuItem>
      );
    }
    if (action.id === "view_invoice" && invoice.hostedInvoiceUrl) {
      return (
        <DropdownMenuItem key={action.id} asChild>
          <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">
            {iconEl}
            {label}
          </a>
        </DropdownMenuItem>
      );
    }
    if (action.stripeAction) {
      return (
        <DropdownMenuItem
          key={action.id}
          disabled={action.disabled}
          className={action.destructive ? "text-destructive focus:text-destructive" : undefined}
          onClick={() => handlers.onStripeAction?.(invoice, action.stripeAction!)}
        >
          {iconEl}
          {label}
        </DropdownMenuItem>
      );
    }
    return null;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger === "icon" ? (
          <button
            type="button"
            aria-label={`Invoice actions for ${invoice.number}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        ) : (
          <Button variant="outline" className="h-9" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="mr-2 h-4 w-4" />
            {triggerLabel}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} onClick={(e) => e.stopPropagation()}>
        {browse.map(renderItem)}
        {browse.length > 0 && mutations.length > 0 && <DropdownMenuSeparator />}
        {mutations.map(renderItem)}
        {(browse.length > 0 || mutations.length > 0) && destructive.length > 0 && <DropdownMenuSeparator />}
        {destructive.map(renderItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
