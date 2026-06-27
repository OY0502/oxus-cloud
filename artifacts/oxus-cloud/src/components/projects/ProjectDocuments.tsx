import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Upload, Download, Trash2, FileCheck2 } from "lucide-react";
import {
  useAttachments,
  useUploadAttachment,
  useDeleteAttachment,
  getAttachmentUrl,
} from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import type { Attachment, DocType } from "@/lib/types";

function FileLine({ a, onDelete, badge }: { a: Attachment; onDelete: () => void; badge?: string }) {
  const open = async () => {
    const url = await getAttachmentUrl(a.file_path);
    if (url) window.open(url, "_blank", "noopener");
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 group">
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-medium truncate">{a.file_name}</span>
        <span className="text-xs text-muted-foreground">{a.file_size ? `${(a.file_size / 1024).toFixed(0)} KB` : ""}</span>
      </div>
      {badge && <Badge variant="outline" className="text-[10px] uppercase">{badge}</Badge>}
      <button className="text-muted-foreground hover:text-foreground transition" onClick={open}><Download className="h-4 w-4" /></button>
      <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function Slot({
  title,
  description,
  current,
  onUpload,
  onDelete,
  busy,
}: {
  title: string;
  description: string;
  current?: Attachment;
  onUpload: (file: File) => void;
  onDelete: (a: Attachment) => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-primary" /> {title}</h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <input ref={ref} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); if (ref.current) ref.current.value = ""; }} />
        <Button variant="outline" size="sm" className="gap-2" onClick={() => ref.current?.click()} disabled={busy}>
          <Upload className="h-4 w-4" /> {current ? "Replace" : "Upload"}
        </Button>
      </div>
      {current && <FileLine a={current} onDelete={() => onDelete(current)} />}
    </div>
  );
}

export function ProjectDocuments({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { data: attachments = [] } = useAttachments("project", projectId);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();
  const otherRef = useRef<HTMLInputElement>(null);

  const msa = attachments.find((a) => a.doc_type === "msa");
  const nda = attachments.find((a) => a.doc_type === "nda");
  const sow = attachments.find((a) => a.doc_type === "sow" && a.is_active);
  const others = attachments.filter((a) => a.doc_type === "other");

  const uploadSingle = async (file: File, docType: DocType, previous?: Attachment) => {
    try {
      // MSA/NDA are single-slot: remove the existing file before uploading the new one.
      if (previous && (docType === "msa" || docType === "nda")) {
        await del.mutateAsync(previous);
      }
      await upload.mutateAsync({ entity_type: "project", entity_id: projectId, file, doc_type: docType });
      toast({ title: "Document uploaded", description: file.name });
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const removeDoc = async (a: Attachment) => {
    try {
      await del.mutateAsync(a);
    } catch (e) {
      toast({ title: "Couldn't delete", description: (e as Error).message, variant: "destructive" });
    }
  };

  const busy = upload.isPending || del.isPending;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Slot title="MSA" description="Master Service Agreement (optional)" current={msa} busy={busy} onUpload={(f) => uploadSingle(f, "msa", msa)} onDelete={removeDoc} />
        <Slot title="NDA" description="Non-Disclosure Agreement (optional)" current={nda} busy={busy} onUpload={(f) => uploadSingle(f, "nda", nda)} onDelete={removeDoc} />
      </div>

      <Slot
        title="Active SOW"
        description="Statement of Work. Uploading a new SOW moves the current one to Other documents."
        current={sow}
        busy={busy}
        onUpload={(f) => uploadSingle(f, "sow")}
        onDelete={removeDoc}
      />

      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold">Other documents</h4>
            <p className="text-xs text-muted-foreground">Any additional files, plus superseded SOWs.</p>
          </div>
          <input ref={otherRef} type="file" multiple className="hidden" onChange={async (e) => {
            const files = e.target.files;
            if (files) for (const f of Array.from(files)) await uploadSingle(f, "other");
            if (otherRef.current) otherRef.current.value = "";
          }} />
          <Button variant="outline" size="sm" className="gap-2" onClick={() => otherRef.current?.click()} disabled={busy}>
            <Upload className="h-4 w-4" /> Upload
          </Button>
        </div>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other documents.</p>
        ) : (
          <div className="space-y-2">
            {others.map((a) => <FileLine key={a.id} a={a} onDelete={() => removeDoc(a)} />)}
          </div>
        )}
      </div>
    </div>
  );
}
