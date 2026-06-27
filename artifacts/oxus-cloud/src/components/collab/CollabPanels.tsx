import React, { useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Trash2, Paperclip, Download, Send, Plus, FileText } from "lucide-react";
import {
  useComments,
  useAddComment,
  useDeleteComment,
  useTasks,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useAttachments,
  useUploadAttachment,
  useDeleteAttachment,
  getAttachmentUrl,
} from "@/hooks/api";
import type { Attachment, EntityType } from "@/lib/types";
import { profileAvatarUrl, profileDisplayName } from "@/lib/profiles";
import { useToast } from "@/hooks/use-toast";

interface PanelProps {
  entityType: EntityType;
  entityId: string;
}

export function CommentsPanel({ entityType, entityId }: PanelProps) {
  const { data: comments = [], isLoading } = useComments(entityType, entityId);
  const add = useAddComment();
  const del = useDeleteComment();
  const [body, setBody] = useState("");

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    await add.mutateAsync({ entity_type: entityType, entity_id: entityId, body: text });
    setBody("");
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment…"
          rows={2}
          className="flex-1"
        />
        <Button size="icon" className="self-end" onClick={submit} disabled={!body.trim() || add.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <div className="space-y-4">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-3 group">
              <Avatar className="w-8 h-8">
                {c.author && <AvatarImage src={profileAvatarUrl(c.author)} />}
                <AvatarFallback>{(c.author ? profileDisplayName(c.author) : "?").charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.author ? profileDisplayName(c.author) : "Unknown"}</span>
                  <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
                  <button
                    className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                    onClick={() => del.mutate({ id: c.id, entity_type: entityType, entity_id: entityId })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TasksPanel({ entityType, entityId }: PanelProps) {
  const { data: tasks = [], isLoading } = useTasks(entityType, entityId);
  const create = useCreateTask();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const [title, setTitle] = useState("");

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    await create.mutateAsync({ entity_type: entityType, entity_id: entityId, title: t });
    setTitle("");
  };

  const toggle = (id: string, done: boolean) =>
    update.mutate({ id, entity_type: entityType, entity_id: entityId, patch: { status: done ? "done" : "todo" } });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <Button size="icon" onClick={add} disabled={!title.trim() || create.isPending}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <div className="space-y-1">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 group">
              <Checkbox checked={t.status === "done"} onCheckedChange={(v) => toggle(t.id, !!v)} />
              <span className={`text-sm flex-1 ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</span>
              {t.assignee && (
                <Avatar className="w-6 h-6">
                  <AvatarImage src={profileAvatarUrl(t.assignee)} />
                  <AvatarFallback>{profileDisplayName(t.assignee).charAt(0)}</AvatarFallback>
                </Avatar>
              )}
              <button
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                onClick={() => del.mutate({ id: t.id, entity_type: entityType, entity_id: entityId })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentRow({ a, onDelete }: { a: Attachment; onDelete: () => void }) {
  const open = async () => {
    const url = await getAttachmentUrl(a.file_path);
    if (url) window.open(url, "_blank", "noopener");
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 group">
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-medium truncate">{a.file_name}</span>
        <span className="text-xs text-muted-foreground">
          {a.file_size ? `${(a.file_size / 1024).toFixed(0)} KB` : ""}
          {a.doc_type !== "attachment" && <Badge variant="outline" className="ml-2 text-[10px] uppercase">{a.doc_type}</Badge>}
        </span>
      </div>
      <button className="text-muted-foreground hover:text-foreground transition" onClick={open}><Download className="h-4 w-4" /></button>
      <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function AttachmentsPanel({ entityType, entityId }: PanelProps) {
  const { toast } = useToast();
  const { data: attachments = [], isLoading } = useAttachments(entityType, entityId);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();
  const inputRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      for (const file of Array.from(files)) {
        await upload.mutateAsync({ entity_type: entityType, entity_id: entityId, file, doc_type: "attachment" });
      }
      toast({ title: "Uploaded", description: `${files.length} file(s)` });
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  // Only show free-form attachments here (documents are managed on the project).
  const items = attachments.filter((a) => a.doc_type === "attachment");

  return (
    <div className="space-y-4">
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      <Button variant="outline" className="gap-2 w-full" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
        <Paperclip className="h-4 w-4" /> {upload.isPending ? "Uploading…" : "Upload file"}
      </Button>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attachments yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <AttachmentRow key={a.id} a={a} onDelete={() => del.mutate(a)} />
          ))}
        </div>
      )}
    </div>
  );
}
