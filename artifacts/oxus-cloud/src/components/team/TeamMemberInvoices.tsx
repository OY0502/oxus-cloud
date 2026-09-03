import React, { useRef, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getContractorInvoiceFileUrl,
  useContractorInvoiceAction,
  useContractorInvoices,
  useContractorInvoiceSummary,
  useUpdateContractorInvoice,
  useUploadContractorInvoiceFile,
} from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import {
  CONTRACTOR_INVOICE_SOURCE_LABELS,
  CONTRACTOR_INVOICE_STATUS_LABELS,
  contractorInvoiceStatusVariant,
  formatInvoicePeriod,
} from "@/lib/contractorInvoices";
import { formatCurrency } from "@/lib/currency";
import type { Contact, ContractorInvoice } from "@/lib/types";
import { ContractorInvoiceDialog } from "./TeamDialogs";
import {
  CheckCircle,
  Download,
  FileText,
  MoreHorizontal,
  Plus,
  Upload,
  XCircle,
} from "lucide-react";
import {
  TeamEmptyState,
  TeamMiniStat,
  TeamOutlineButton,
  TeamPanelHeader,
  TeamRecordField,
  TeamRecordItem,
  TeamRecordList,
  teamActionBtn,
  teamIcon,
} from "./teamUi";

export function TeamMemberInvoicesPanel({
  person,
  canManage,
  onRecordPayment,
}: {
  person: Contact;
  canManage: boolean;
  onRecordPayment?: (invoiceId?: string) => void;
}) {
  const { toast } = useToast();
  const { data: invoices = [], isLoading } = useContractorInvoices(person.id, { enabled: canManage });
  const summaryQuery = useContractorInvoiceSummary(person.id, { enabled: canManage });
  const invoiceAction = useContractorInvoiceAction();
  const uploadFile = useUploadContractorInvoiceFile();
  const updateInvoice = useUpdateContractorInvoice();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editInvoice, setEditInvoice] = useState<ContractorInvoice | null>(null);

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Member invoices are restricted to admins.</p>;
  }

  const summary = summaryQuery.data;

  const runAction = async (invoice: ContractorInvoice, action: "approve" | "dispute" | "cancel") => {
    try {
      await invoiceAction.mutateAsync({ invoice_id: invoice.id, person_id: person.id, action });
      toast({ title: `Invoice ${action === "approve" ? "approved" : action === "dispute" ? "marked disputed" : "cancelled"}` });
    } catch (error) {
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = async (invoice: ContractorInvoice) => {
    try {
      const url = await getContractorInvoiceFileUrl(invoice.id);
      if (!url) {
        toast({ title: "No attachment", variant: "destructive" });
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const invoiceId = uploadTarget;
    event.target.value = "";
    setUploadTarget(null);
    if (!file || !invoiceId) return;

    try {
      await uploadFile.mutateAsync({ invoice_id: invoiceId, person_id: person.id, file });
      toast({ title: "Attachment uploaded" });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => void handleFileChange(event)}
      />

      <TeamPanelHeader
        title="Supporting invoices"
        action={
          <TeamOutlineButton onClick={() => { setEditInvoice(null); setDialogOpen(true); }}>
            <Plus className={teamIcon} /> Add invoice
          </TeamOutlineButton>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TeamMiniStat label="Outstanding" value={formatCurrency(summary?.outstanding ?? 0)} />
        <TeamMiniStat label="Due this month" value={formatCurrency(summary?.due_this_month ?? 0)} />
        <TeamMiniStat label="Paid this year" value={formatCurrency(summary?.paid_ytd ?? 0)} />
        <TeamMiniStat label="Invoices" value={String(summary?.invoice_count ?? 0)} />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <TeamEmptyState
          title="No supporting invoices"
          description="Upload or record contractor invoices to connect payments with supporting documents."
        />
      ) : (
        <TeamRecordList>
          {invoices.map((invoice) => (
            <TeamRecordItem
              key={invoice.id}
              title={
                <>
                  <span>Invoice {invoice.invoice_number ?? invoice.id.slice(0, 8)}</span>
                  <StatusBadge
                    status={CONTRACTOR_INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
                    variant={contractorInvoiceStatusVariant(invoice.status)}
                  />
                </>
              }
              subtitle={[
                invoice.projects?.name,
                formatInvoicePeriod(invoice),
              ].filter(Boolean).join(" · ")}
              trailing={
                <>
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                    {formatCurrency(invoice.total, invoice.currency, true)}
                  </div>
                  {invoice.paid_amount > 0 && (
                    <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {formatCurrency(invoice.paid_amount, invoice.currency, true)} paid
                    </div>
                  )}
                </>
              }
              details={
                <>
                  <TeamRecordField label="Issued">{invoice.invoice_date}</TeamRecordField>
                  <TeamRecordField label="Due">{invoice.due_date ?? "—"}</TeamRecordField>
                  <TeamRecordField label="Source">
                    {CONTRACTOR_INVOICE_SOURCE_LABELS[invoice.source] ?? invoice.source}
                  </TeamRecordField>
                </>
              }
              actions={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className={teamActionBtn.menu} aria-label="Invoice actions">
                      <MoreHorizontal className={teamIcon} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => { setEditInvoice(invoice); setDialogOpen(true); }}>
                      <FileText className="mr-2 h-4 w-4" /> View invoice
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { setUploadTarget(invoice.id); fileInputRef.current?.click(); }}>
                      <Upload className="mr-2 h-4 w-4" /> Upload document
                    </DropdownMenuItem>
                    {invoice.file_path && (
                      <DropdownMenuItem onSelect={() => void handleDownload(invoice)}>
                        <Download className="mr-2 h-4 w-4" /> Download attachment
                      </DropdownMenuItem>
                    )}
                    {["received", "partially_paid"].includes(invoice.status) && (
                      <DropdownMenuItem onSelect={() => void runAction(invoice, "approve")}>
                        <CheckCircle className="mr-2 h-4 w-4" /> Approve
                      </DropdownMenuItem>
                    )}
                    {["received", "approved", "partially_paid"].includes(invoice.status) && onRecordPayment && (
                      <DropdownMenuItem onSelect={() => onRecordPayment(invoice.id)}>Record payment</DropdownMenuItem>
                    )}
                    {!["paid", "cancelled"].includes(invoice.status) && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void runAction(invoice, "dispute")}>Mark disputed</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void runAction(invoice, "cancel")}>
                          <XCircle className="mr-2 h-4 w-4" /> Cancel invoice
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
          ))}
        </TeamRecordList>
      )}

      <ContractorInvoiceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        person={person}
        invoice={editInvoice}
        onAssignProject={async (invoiceId, projectId) => {
          await updateInvoice.mutateAsync({
            id: invoiceId,
            person_id: person.id,
            patch: { project_id: projectId },
          });
        }}
      />
    </div>
  );
}
