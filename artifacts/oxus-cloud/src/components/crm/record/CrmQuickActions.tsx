import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarPlus,
  Check,
  Edit,
  ExternalLink,
  GitMerge,
  Mail,
  MoreHorizontal,
  Pencil,
  StickyNote,
  ListTodo,
  EyeOff,
  Trash2,
  UserX,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type CrmQuickActionsProps = {
  email?: string | null;
  onEdit: () => void;
  onEmail: () => void;
  onNote: () => void;
  onMeeting: () => void;
  onTask: () => void;
  onOpenProfile?: () => void;
  onAssociateCompany?: () => void;
  onMerge?: () => void;
  onInactive?: () => void;
  onSuppress?: () => void;
  onDelete?: () => void;
  editing?: boolean;
};

export function CrmQuickActions({
  email,
  onEdit,
  onEmail,
  onNote,
  onMeeting,
  onTask,
  onOpenProfile,
  onAssociateCompany,
  onMerge,
  onInactive,
  onSuppress,
  onDelete,
  editing,
}: CrmQuickActionsProps) {
  const { isSuperAdmin } = useAuth();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button variant="outline" size="sm" className="h-9" onClick={onEdit}>
        {editing ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Edit className="mr-1.5 h-3.5 w-3.5" />}
        {editing ? "Done" : "Edit"}
      </Button>
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onEmail} disabled={!email} title="Email">
        <Mail className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onNote} title="Add note">
        <StickyNote className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onMeeting} title="Schedule meeting">
        <CalendarPlus className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onTask} title="Create task">
        <ListTodo className="h-4 w-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onOpenProfile && (
            <DropdownMenuItem onClick={onOpenProfile}>
              <ExternalLink className="mr-2 h-4 w-4" /> Open full profile
            </DropdownMenuItem>
          )}
          {onAssociateCompany && (
            <DropdownMenuItem onClick={onAssociateCompany}>
              <Pencil className="mr-2 h-4 w-4" /> Associate company
            </DropdownMenuItem>
          )}
          {isSuperAdmin && onMerge && (
            <DropdownMenuItem onClick={onMerge}>
              <GitMerge className="mr-2 h-4 w-4" /> Merge record
            </DropdownMenuItem>
          )}
          {onInactive && (
            <DropdownMenuItem onClick={onInactive}>
              <UserX className="mr-2 h-4 w-4" /> Mark inactive
            </DropdownMenuItem>
          )}
          {isSuperAdmin && onSuppress && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSuppress}>
                <EyeOff className="mr-2 h-4 w-4" /> Suppress
              </DropdownMenuItem>
            </>
          )}
          {isSuperAdmin && onDelete && (
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

type CrmNoteComposerProps = {
  open: boolean;
  onClose: () => void;
  onSave: (body: string) => Promise<void>;
  saving?: boolean;
};

export function CrmNoteComposer({ open, onClose, onSave, saving }: CrmNoteComposerProps) {
  const [body, setBody] = useState("");
  if (!open) return null;

  return (
    <div className="mb-4 space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="text-sm font-medium">Add note</div>
      <textarea
        className="min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm"
        placeholder="Write an internal note..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => { setBody(""); onClose(); }}>Cancel</Button>
        <Button
          size="sm"
          disabled={!body.trim() || saving}
          onClick={async () => {
            await onSave(body.trim());
            setBody("");
            onClose();
          }}
        >
          Save note
        </Button>
      </div>
    </div>
  );
}
