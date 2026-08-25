import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePandaDocConnectionStatus, usePandaDocListDocuments, usePandaDocLinkProjectDocument } from "@/hooks/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { FileText, Loader2, Search } from "lucide-react";
import type { NormalizedPandaDocDocument, ProjectDocumentSlotType } from "@/lib/types";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "document.draft", label: "Draft" },
  { value: "document.sent", label: "Sent" },
  { value: "document.viewed", label: "Viewed" },
  { value: "document.completed", label: "Completed" },
  { value: "document.declined", label: "Declined" },
];

function formatStatus(status: string) {
  return status.replace(/^document\./, "").replace(/_/g, " ");
}

export function PandaDocDocumentSelector({
  open,
  onOpenChange,
  projectId,
  documentType,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  documentType: ProjectDocumentSlotType;
  onLinked?: () => void;
}) {
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const { data: connection } = usePandaDocConnectionStatus({ enabled: isSuperAdmin && open });
  const listDocs = usePandaDocListDocuments();
  const linkDoc = usePandaDocLinkProjectDocument();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [docs, setDocs] = useState<NormalizedPandaDocDocument[]>([]);
  const [selected, setSelected] = useState<NormalizedPandaDocDocument | null>(null);

  const load = async (nextPage = page, nextQuery = query, nextStatus = status) => {
    try {
      const result = await listDocs.mutateAsync({
        query: nextQuery.trim() || undefined,
        status: nextStatus === "all" ? undefined : nextStatus,
        page: nextPage,
        count: 20,
      });
      setDocs(result.documents);
      setPage(result.page);
    } catch (e) {
      toast({
        title: "Could not load PandaDoc documents",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!open || !isSuperAdmin || !connection?.configured) return;
    void load(1, query, status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connection?.configured, isSuperAdmin]);

  const confirmLink = async () => {
    if (!selected) return;
    try {
      await linkDoc.mutateAsync({
        project_id: projectId,
        pandadoc_document_id: selected.external_id,
        document_type: documentType,
      });
      toast({ title: "PandaDoc document linked", description: selected.name });
      onLinked?.();
      onOpenChange(false);
      setSelected(null);
    } catch (e) {
      toast({
        title: "Could not link document",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select from PandaDoc</DialogTitle>
          <DialogDescription>
            Search existing PandaDoc documents and assign one to this project. Content is not copied into OXUS Cloud.
          </DialogDescription>
        </DialogHeader>

        {!isSuperAdmin ? (
          <p className="text-sm text-muted-foreground">
            Only admins can browse the PandaDoc workspace. Ask a super admin to link a document.
          </p>
        ) : !connection?.configured ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              PandaDoc is not configured. Set <code className="text-xs">PANDADOC_API_KEY</code> and connect it in Settings.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/integrations#pandadoc-integration">Open Settings → Integrations</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4 flex-1 min-h-0 flex flex-col">
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search by name…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void load(1, query, status);
                  }}
                />
              </div>
              <Select value={status} onValueChange={(v) => { setStatus(v); void load(1, query, v); }}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => void load(1, query, status)} disabled={listDocs.isPending}>
                {listDocs.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 min-h-[240px] border rounded-lg p-2">
              {docs.length === 0 && !listDocs.isPending ? (
                <p className="text-sm text-muted-foreground p-4 text-center">No documents found.</p>
              ) : (
                docs.map((doc) => (
                  <button
                    key={doc.external_id}
                    type="button"
                    onClick={() => setSelected(doc)}
                    className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                      selected?.external_id === doc.external_id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{doc.name}</p>
                        <div className="flex flex-wrap gap-2 mt-1 items-center">
                          <Badge variant="outline" className="text-[10px] uppercase">{formatStatus(doc.status)}</Badge>
                          {doc.owner_name && (
                            <span className="text-[11px] text-muted-foreground">{doc.owner_name}</span>
                          )}
                          {doc.date_modified && (
                            <span className="text-[11px] text-muted-foreground">
                              {new Date(doc.date_modified).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {doc.recipients?.length ? (
                          <p className="text-[11px] text-muted-foreground mt-1 truncate">
                            {doc.recipients.map((r) => r.email || r.name).filter(Boolean).slice(0, 3).join(", ")}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1 || listDocs.isPending}
                onClick={() => void load(page - 1)}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {page}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={docs.length < 20 || listDocs.isPending}
                onClick={() => void load(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void confirmLink()} disabled={!selected || linkDoc.isPending}>
            {linkDoc.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Link document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
