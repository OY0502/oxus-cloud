import React, { useEffect, useState } from "react";
import { Check, Pencil, Plus, Puzzle, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useUpdateProjectPmProfile, type UpdateProjectPmProfileInput } from "@/hooks/api";
import { cn } from "@/lib/utils";

type EditableField = keyof UpdateProjectPmProfileInput["updates"];

interface Props {
  projectId: string;
  title: string;
  field: EditableField;
  value: string | string[] | null;
  type?: "text" | "list";
  aiMemory?: boolean;
  variant?: "default" | "attention" | "success";
  readOnly?: boolean;
  emptyLabel?: string;
  children?: React.ReactNode;
  className?: string;
}

export function EditableMemoryBlock({
  projectId,
  title,
  field,
  value,
  type = "text",
  aiMemory = true,
  variant = "default",
  readOnly = false,
  emptyLabel = "Not captured yet.",
  children,
  className,
}: Props) {
  const { toast } = useToast();
  const updateProfile = useUpdateProjectPmProfile();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftItems, setDraftItems] = useState<string[]>([]);

  const displayValue = type === "list" ? (Array.isArray(value) ? value : []) : (value ?? "");

  useEffect(() => {
    if (!editing) return;
    if (type === "list") {
      const items = Array.isArray(value) ? value : [];
      setDraftItems(items.length > 0 ? [...items] : [""]);
      setDraft("");
      return;
    }
    setDraft(typeof value === "string" ? value : "");
    setDraftItems([]);
  }, [editing, type, value]);

  const save = async () => {
    const updates =
      type === "list"
        ? { [field]: draftItems.map((item) => item.trim()).filter(Boolean) }
        : { [field]: draft.trim() || null };
    try {
      await updateProfile.mutateAsync({ project_id: projectId, updates });
      setEditing(false);
      toast({ title: "Memory updated", description: `${title} saved.` });
    } catch (e) {
      toast({
        title: "Could not save",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
    setDraftItems([]);
  };

  const updateDraftItem = (index: number, next: string) => {
    setDraftItems((items) => items.map((item, i) => (i === index ? next : item)));
  };

  const removeDraftItem = (index: number) => {
    setDraftItems((items) => (items.length <= 1 ? [""] : items.filter((_, i) => i !== index)));
  };

  const addDraftItem = () => {
    setDraftItems((items) => [...items, ""]);
  };

  const hasContent =
    type === "list"
      ? Array.isArray(value) && value.length > 0
      : typeof value === "string" && value.trim().length > 0;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-soft overflow-hidden",
        variant === "attention" && "border-amber/40 bg-amber/[0.06] border-l-4 border-l-amber",
        variant === "success" && "border-soft-green/30",
        variant === "default" && "border-card-border",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-4 py-2.5 border-b",
          variant === "attention" ? "border-amber/20 bg-amber/[0.04]" : "border-border/60 bg-muted/30",
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <h4 className="section-label">{title}</h4>
          {aiMemory && hasContent && (
            <Badge
              variant="outline"
              className="gap-1 h-5 text-[10px] border-soft-violet/40 bg-soft-violet/10 text-soft-violet font-medium"
            >
              <Puzzle className="h-2.5 w-2.5" />
              AI Memory
            </Badge>
          )}
        </div>
        {!editing && !readOnly && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-cool-slate hover:text-foreground"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${title}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="px-4 py-3">
        {editing ? (
          <div className="space-y-2">
            {type === "list" ? (
              <div className="space-y-2">
                {draftItems.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={item}
                      onChange={(e) => updateDraftItem(index, e.target.value)}
                      placeholder={`Item ${index + 1}`}
                      className="text-sm h-9"
                      autoFocus={index === 0}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-cool-slate hover:text-destructive"
                      onClick={() => removeDraftItem(index)}
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1" onClick={addDraftItem}>
                  <Plus className="h-3 w-3" /> Add item
                </Button>
              </div>
            ) : (
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                placeholder="Enter text…"
                className="text-sm"
                autoFocus
              />
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={cancel} disabled={updateProfile.isPending}>
                <X className="h-3 w-3" /> Cancel
              </Button>
              <Button size="sm" className="h-7 gap-1" onClick={save} disabled={updateProfile.isPending}>
                <Check className="h-3 w-3" />
                {updateProfile.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : children ? (
          children
        ) : type === "list" ? (
          Array.isArray(displayValue) && displayValue.length > 0 ? (
            <p className="text-sm text-foreground/90">{displayValue.join(" · ")}</p>
          ) : (
            <p className="text-sm text-cool-slate italic">{emptyLabel}</p>
          )
        ) : typeof displayValue === "string" && displayValue.trim() ? (
          <p className="text-sm text-foreground/90 leading-relaxed">{displayValue}</p>
        ) : (
          <p className="text-sm text-cool-slate italic">{emptyLabel}</p>
        )}
      </div>
    </div>
  );
}
