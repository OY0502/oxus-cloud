import React, { useRef, useState } from "react";

import { DataTable } from "@/components/DataTable";

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

  useContractorInvoices,

  useContractorInvoiceSummary,

  useContractorInvoiceAction,

  useUploadContractorInvoiceFile,

  getContractorInvoiceFileUrl,

  useUpdateContractorInvoice,

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
import { TeamMiniStat, TeamOutlineButton, TeamPanelHeader, teamActionBtn, teamIcon } from "./teamUi";



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

    return <p className="text-sm text-muted-foreground">Contractor invoices are restricted to admins.</p>;

  }



  const summary = summaryQuery.data;



  const runAction = async (invoice: ContractorInvoice, action: "approve" | "dispute" | "cancel") => {

    try {

      await invoiceAction.mutateAsync({ invoice_id: invoice.id, person_id: person.id, action });

      toast({ title: `Invoice ${action === "approve" ? "approved" : action === "dispute" ? "marked disputed" : "cancelled"}` });

    } catch (e) {

      toast({

        title: "Action failed",

        description: e instanceof Error ? e.message : "Try again.",

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

    } catch (e) {

      toast({

        title: "Download failed",

        description: e instanceof Error ? e.message : "Try again.",

        variant: "destructive",

      });

    }

  };



  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {

    const file = e.target.files?.[0];

    const invoiceId = uploadTarget;

    e.target.value = "";

    setUploadTarget(null);

    if (!file || !invoiceId) return;

    try {

      await uploadFile.mutateAsync({ invoice_id: invoiceId, person_id: person.id, file });

      toast({ title: "Attachment uploaded" });

    } catch (err) {

      toast({

        title: "Upload failed",

        description: err instanceof Error ? err.message : "Try again.",

        variant: "destructive",

      });

    }

  };



  const columns = [

    {

      id: "number",

      header: "Invoice #",

      cell: (i: ContractorInvoice) => i.invoice_number ?? i.id.slice(0, 8),

    },

    { id: "date", header: "Date", cell: (i: ContractorInvoice) => i.invoice_date },

    { id: "period", header: "Period", cell: (i: ContractorInvoice) => formatInvoicePeriod(i) },

    { id: "project", header: "Project", cell: (i: ContractorInvoice) => i.projects?.name ?? "—" },

    {

      id: "amount",

      header: "Amount",

      cell: (i: ContractorInvoice) => formatCurrency(i.total, i.currency, true),

    },

    {

      id: "status",

      header: "Status",

      cell: (i: ContractorInvoice) => (

        <StatusBadge

          status={CONTRACTOR_INVOICE_STATUS_LABELS[i.status] ?? i.status}

          variant={contractorInvoiceStatusVariant(i.status)}

        />

      ),

    },

    {

      id: "paid",

      header: "Paid",

      cell: (i: ContractorInvoice) => formatCurrency(i.paid_amount, i.currency, true),

    },

    { id: "due", header: "Due", cell: (i: ContractorInvoice) => i.due_date ?? "—" },

    {

      id: "source",

      header: "Source",

      cell: (i: ContractorInvoice) => (

        <StatusBadge status={CONTRACTOR_INVOICE_SOURCE_LABELS[i.source] ?? i.source} variant="neutral" />

      ),

    },

    {

      id: "actions",

      header: "",

      cell: (i: ContractorInvoice) => (

        <DropdownMenu>

          <DropdownMenuTrigger asChild>

            <Button variant="ghost" size="icon" className={teamActionBtn.menu}>
              <MoreHorizontal className={teamIcon} />
            </Button>

          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">

            <DropdownMenuItem onSelect={() => { setEditInvoice(i); setDialogOpen(true); }}>

              <FileText className="w-4 h-4 mr-2" /> View invoice

            </DropdownMenuItem>

            <DropdownMenuItem onSelect={() => { setUploadTarget(i.id); fileInputRef.current?.click(); }}>

              <Upload className="w-4 h-4 mr-2" /> Upload document

            </DropdownMenuItem>

            {i.file_path && (

              <DropdownMenuItem onSelect={() => void handleDownload(i)}>

                <Download className="w-4 h-4 mr-2" /> Download attachment

              </DropdownMenuItem>

            )}

            {["received", "partially_paid"].includes(i.status) && (

              <DropdownMenuItem onSelect={() => void runAction(i, "approve")}>

                <CheckCircle className="w-4 h-4 mr-2" /> Approve

              </DropdownMenuItem>

            )}

            {["received", "approved", "partially_paid"].includes(i.status) && onRecordPayment && (

              <DropdownMenuItem onSelect={() => onRecordPayment(i.id)}>

                Record payment

              </DropdownMenuItem>

            )}

            {!["paid", "cancelled"].includes(i.status) && (

              <>

                <DropdownMenuSeparator />

                <DropdownMenuItem onSelect={() => void runAction(i, "dispute")}>Mark disputed</DropdownMenuItem>

                <DropdownMenuItem className="text-destructive" onSelect={() => void runAction(i, "cancel")}>

                  <XCircle className="w-4 h-4 mr-2" /> Cancel

                </DropdownMenuItem>

              </>

            )}

          </DropdownMenuContent>

        </DropdownMenu>

      ),

    },

  ];



  return (
    <div className="min-w-0 space-y-4">
      <input ref={fileInputRef} type="file" accept=".pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void handleFileChange(e)} />

      <TeamPanelHeader
        title="Contractor invoices"
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

        <p className="text-sm text-muted-foreground">No contractor invoices recorded yet.</p>

      ) : (

        <DataTable tableId={`team-invoices-${person.id}`} data={invoices} columns={columns} />

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


