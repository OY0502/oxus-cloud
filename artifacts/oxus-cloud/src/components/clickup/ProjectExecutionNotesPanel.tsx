import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateProjectExecutionNote,
  useDeleteProjectExecutionNote,
  useProjectExecutionNotes,
  useUpdateProjectExecutionNote,
} from "@/hooks/api";
import { profileDisplayName } from "@/lib/profiles";
import type { ProjectExecutionNote } from "@/lib/types";

interface Props {
  projectId: string;
}

function canManageNote(note: ProjectExecutionNote, userId: string | undefined, isSuperAdmin: boolean, isPM: boolean) {
  if (!userId) return false;
  if (isSuperAdmin || isPM) return true;
  return note.author_id === userId;
}

export function ProjectExecutionNotesPanel({ projectId }: Props) {
  const { user, isSuperAdmin, isPM } = useAuth();
  const { toast } = useToast();
  const { data: notes = [], isLoading } = useProjectExecutionNotes(projectId);
  const createNote = useCreateProjectExecutionNote();
  const updateNote = useUpdateProjectExecutionNote();
  const deleteNote = useDeleteProjectExecutionNote();

  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const busy = createNote.isPending || updateNote.isPending || deleteNote.isPending;

  const addNote = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      await createNote.mutateAsync({ project_id: projectId, note_text: text });
      setDraft("");
      toast({ title: "Note added" });
    } catch (e) {
      toast({ title: "Could not add note", description: (e as Error).message, variant: "destructive" });
    }
  };

  const saveEdit = async (note: ProjectExecutionNote) => {
    const text = editText.trim();
    if (!text) return;
    try {
      await updateNote.mutateAsync({ id: note.id, project_id: projectId, note_text: text });
      setEditingId(null);
      setEditText("");
      toast({ title: "Note updated" });
    } catch (e) {
      toast({ title: "Could not update note", description: (e as Error).message, variant: "destructive" });
    }
  };

  const removeNote = async (note: ProjectExecutionNote) => {
    try {
      await deleteNote.mutateAsync({ id: note.id, project_id: projectId });
      if (editingId === note.id) {
        setEditingId(null);
        setEditText("");
      }
      toast({ title: "Note deleted" });
    } catch (e) {
      toast({ title: "Could not delete note", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="section-label">Execution Notes</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Internal notes only. These are not used by AI memory.
        </p>
      </div>

      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Add a note about ClickUp setup, delivery coordination, or admin details…"
          className="text-sm min-h-0"
        />
        <Button size="sm" className="h-8" onClick={addNote} disabled={!draft.trim() || busy}>
          {createNote.isPending ? "Adding…" : "Add note"}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No execution notes yet.</p>
      ) : (
        <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {notes.map((note) => {
            const editable = canManageNote(note, user?.id, isSuperAdmin, isPM);
            const isEditing = editingId === note.id;

            return (
              <li key={note.id} className="rounded-lg border border-border bg-card px-3 py-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">
                      {note.author ? profileDisplayName(note.author) : "Team member"}
                    </span>
                    <span className="mx-1">·</span>
                    <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
                  </div>
                  {editable && !isEditing && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          setEditingId(note.id);
                          setEditText(note.note_text);
                        }}
                        aria-label="Edit note"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => void removeNote(note)}
                        disabled={busy}
                        aria-label="Delete note"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      className="text-sm min-h-0"
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={() => {
                          setEditingId(null);
                          setEditText("");
                        }}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" className="h-7" onClick={() => void saveEdit(note)} disabled={!editText.trim() || busy}>
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap">{note.note_text}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
