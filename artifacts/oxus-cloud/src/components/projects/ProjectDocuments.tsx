import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Upload,
  Download,
  Trash2,
  FileCheck2,
  ExternalLink,
  RefreshCw,
  Unlink,
} from "lucide-react";
import {
  useAttachments,
  useUploadAttachment,
  useDeleteAttachment,
  getAttachmentUrl,
  usePandaDocUnlinkProjectDocument,
  usePandaDocSyncProjectDocuments,
} from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { PandaDocDocumentSelector } from "@/components/projects/PandaDocDocumentSelector";
import type { Attachment, DocType, ProjectDocumentSlotType } from "@/lib/types";

function providerOf(a: Attachment): "upload" | "pandadoc" {
  return a.provider === "pandadoc" ? "pandadoc" : "upload";
}

function displayName(a: Attachment) {
  return a.title || a.file_name || "Document";
}

function formatStatus(status: string | null | undefined) {
  if (!status) return null;
  return status.replace(/^document\./, "").replace(/_/g, " ");
}

function DocRow({
  a,
  onDelete,
  onUnlink,
  canManagePandaDoc,
  badge,
}: {
  a: Attachment;
  onDelete: () => void;
  onUnlink?: () => void;
  canManagePandaDoc: boolean;
  badge?: string;
}) {
  const provider = providerOf(a);
  const open = async () => {
    if (provider === "pandadoc" && a.external_url) {
      window.open(a.external_url, "_blank", "noopener");
      return;
    }
    if (a.file_path) {
      const url = await getAttachmentUrl(a.file_path);
      if (url) window.open(url, "_blank", "noopener");
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 group">
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-medium truncate">{displayName(a)}</span>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <Badge variant="secondary" className="text-[10px] uppercase">
            {provider === "pandadoc" ? "PandaDoc" : "Uploaded"}
          </Badge>
          {formatStatus(a.status) && (
            <Badge variant="outline" className="text-[10px] capitalize">{formatStatus(a.status)}</Badge>
          )}
          {badge && <Badge variant="outline" className="text-[10px] uppercase">{badge}</Badge>}
          {a.last_synced_at && (
            <span className="text-[10px] text-muted-foreground">
              Synced {new Date(a.last_synced_at).toLocaleDateString()}
            </span>
          )}
          {provider === "upload" && a.file_size ? (
            <span className="text-[10px] text-muted-foreground">{(a.file_size / 1024).toFixed(0)} KB</span>
          ) : null}
        </div>
      </div>
      <button className="text-muted-foreground hover:text-foreground transition" onClick={() => void open()} title={provider === "pandadoc" ? "Open in PandaDoc" : "Download"}>
        {provider === "pandadoc" ? <ExternalLink className="h-4 w-4" /> : <Download className="h-4 w-4" />}
      </button>
      {provider === "pandadoc" && canManagePandaDoc && onUnlink ? (
        <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition" onClick={onUnlink} title="Unlink">
          <Unlink className="h-3.5 w-3.5" />
        </button>
      ) : (
        <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition" onClick={onDelete} title="Remove">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function Slot({
  title,
  description,
  current,
  onUpload,
  onDelete,
  onUnlink,
  onSelectPandaDoc,
  canManagePandaDoc,
  busy,
}: {
  title: string;
  description: string;
  current?: Attachment;
  onUpload: (file: File) => void;
  onDelete: (a: Attachment) => void;
  onUnlink: (a: Attachment) => void;
  onSelectPandaDoc: () => void;
  canManagePandaDoc: boolean;
  busy: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-primary" /> {title}
          </h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <input
            ref={ref}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              if (ref.current) ref.current.value = "";
            }}
          />
          <Button variant="outline" size="sm" className="gap-2" onClick={() => ref.current?.click()} disabled={busy}>
            <Upload className="h-4 w-4" /> {current ? "Replace file" : "Upload file"}
          </Button>
          {canManagePandaDoc && (
            <Button variant="outline" size="sm" onClick={onSelectPandaDoc} disabled={busy}>
              {current ? "Replace from PandaDoc" : "Select from PandaDoc"}
            </Button>
          )}
        </div>
      </div>
      {current ? (
        <DocRow
          a={current}
          canManagePandaDoc={canManagePandaDoc}
          onDelete={() => onDelete(current)}
          onUnlink={() => onUnlink(current)}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No document assigned</p>
      )}
    </div>
  );
}

export function ProjectDocuments({
  projectId,
  showSync = true,
}: {
  projectId: string;
  showSync?: boolean;
}) {
  const { toast } = useToast();
  const { isSuperAdmin } = useAuth();
  const { data: attachments = [], refetch } = useAttachments("project", projectId);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();
  const unlink = usePandaDocUnlinkProjectDocument();
  const sync = usePandaDocSyncProjectDocuments();
  const otherRef = useRef<HTMLInputElement>(null);
  const [selectorType, setSelectorType] = useState<ProjectDocumentSlotType | null>(null);

  const msa = attachments.find((a) => a.doc_type === "msa" && a.is_active !== false);
  const nda = attachments.find((a) => a.doc_type === "nda" && a.is_active !== false);
  const sow = attachments.find((a) => a.doc_type === "sow" && a.is_active);
  const others = attachments.filter(
    (a) => a.doc_type === "other" || (a.doc_type === "sow" && !a.is_active) || (a.doc_type === "msa" && a.is_active === false),
  );

  const uploadSingle = async (file: File, docType: DocType, previous?: Attachment) => {
    try {
      if (previous && (docType === "msa" || docType === "nda") && providerOf(previous) === "upload") {
        await del.mutateAsync(previous);
      }
      if (previous && (docType === "msa" || docType === "nda") && providerOf(previous) === "pandadoc" && isSuperAdmin) {
        await unlink.mutateAsync({ attachment_id: previous.id, project_id: projectId });
      }
      await upload.mutateAsync({ entity_type: "project", entity_id: projectId, file, doc_type: docType });
      toast({ title: "Document uploaded", description: file.name });
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const removeDoc = async (a: Attachment) => {
    try {
      if (providerOf(a) === "pandadoc") {
        if (!isSuperAdmin) {
          toast({ title: "Admin required", description: "Only admins can unlink PandaDoc documents.", variant: "destructive" });
          return;
        }
        await unlink.mutateAsync({ attachment_id: a.id, project_id: projectId });
        toast({ title: "PandaDoc document unlinked" });
        return;
      }
      await del.mutateAsync(a);
    } catch (e) {
      toast({ title: "Couldn't remove", description: (e as Error).message, variant: "destructive" });
    }
  };

  const busy = upload.isPending || del.isPending || unlink.isPending || sync.isPending;

  return (
    <div className="space-y-4">
      {showSync && isSuperAdmin && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            disabled={busy}
            onClick={() => {
              sync.mutate(
                { project_id: projectId },
                {
                  onSuccess: (r) => {
                    if (r.skipped) {
                      toast({ title: "Sync skipped", description: r.reason });
                      return;
                    }
                    toast({ title: "PandaDoc sync complete", description: `${r.synced} updated${r.failed ? `, ${r.failed} failed` : ""}` });
                    void refetch();
                  },
                  onError: (e) => toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" }),
                },
              );
            }}
          >
            <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
            Sync PandaDoc statuses
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Slot
          title="MSA"
          description="Master Service Agreement (optional)"
          current={msa}
          busy={busy}
          canManagePandaDoc={isSuperAdmin}
          onUpload={(f) => void uploadSingle(f, "msa", msa)}
          onDelete={(a) => void removeDoc(a)}
          onUnlink={(a) => void removeDoc(a)}
          onSelectPandaDoc={() => setSelectorType("msa")}
        />
        <Slot
          title="NDA"
          description="Non-Disclosure Agreement (optional)"
          current={nda}
          busy={busy}
          canManagePandaDoc={isSuperAdmin}
          onUpload={(f) => void uploadSingle(f, "nda", nda)}
          onDelete={(a) => void removeDoc(a)}
          onUnlink={(a) => void removeDoc(a)}
          onSelectPandaDoc={() => setSelectorType("nda")}
        />
      </div>

      <Slot
        title="Active SOW"
        description="Statement of Work. Replacing moves the previous SOW to Other documents (history preserved)."
        current={sow}
        busy={busy}
        canManagePandaDoc={isSuperAdmin}
        onUpload={(f) => void uploadSingle(f, "sow")}
        onDelete={(a) => void removeDoc(a)}
        onUnlink={(a) => void removeDoc(a)}
        onSelectPandaDoc={() => setSelectorType("active_sow")}
      />

      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold">Other documents</h4>
            <p className="text-xs text-muted-foreground">Additional files, superseded SOWs, and historical versions.</p>
          </div>
          <div className="flex gap-2">
            <input
              ref={otherRef}
              type="file"
              multiple
              className="hidden"
              onChange={async (e) => {
                const files = e.target.files;
                if (files) for (const f of Array.from(files)) await uploadSingle(f, "other");
                if (otherRef.current) otherRef.current.value = "";
              }}
            />
            <Button variant="outline" size="sm" className="gap-2" onClick={() => otherRef.current?.click()} disabled={busy}>
              <Upload className="h-4 w-4" /> Upload
            </Button>
            {isSuperAdmin && (
              <Button variant="outline" size="sm" onClick={() => setSelectorType("other")} disabled={busy}>
                Select from PandaDoc
              </Button>
            )}
          </div>
        </div>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other documents.</p>
        ) : (
          <div className="space-y-2">
            {others.map((a) => (
              <DocRow
                key={a.id}
                a={a}
                canManagePandaDoc={isSuperAdmin}
                badge={a.doc_type === "sow" && !a.is_active ? "Superseded SOW" : undefined}
                onDelete={() => void removeDoc(a)}
                onUnlink={() => void removeDoc(a)}
              />
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        PandaDoc links store metadata and status only. Document content is not ingested into Project Intelligence in this integration.
      </p>

      {selectorType && (
        <PandaDocDocumentSelector
          open={!!selectorType}
          onOpenChange={(open) => {
            if (!open) setSelectorType(null);
          }}
          projectId={projectId}
          documentType={selectorType}
          onLinked={() => void refetch()}
        />
      )}
    </div>
  );
}
