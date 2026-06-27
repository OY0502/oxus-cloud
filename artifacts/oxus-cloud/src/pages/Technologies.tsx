import React, { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Cpu, Pencil, Trash2 } from "lucide-react";
import {
  FormDialog,
  TextField,
} from "@/components/forms/FormKit";
import {
  useTechnologies,
  useCreateTechnology,
  useUpdateTechnology,
  useDeleteTechnology,
} from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/states/QueryStates";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Technology } from "@/lib/types";

const SWATCHES = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6"];

function TechDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Technology | null;
}) {
  const { toast } = useToast();
  const create = useCreateTechnology();
  const update = useUpdateTechnology();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(SWATCHES[0]);

  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setColor(initial?.color ?? SWATCHES[0]);
    }
  }, [open, initial]);

  const submit = async () => {
    try {
      if (initial) {
        await update.mutateAsync({ id: initial.id, patch: { name, color } });
        toast({ title: "Technology updated", description: name });
      } else {
        await create.mutateAsync({ name, color });
        toast({ title: "Technology added", description: name });
      }
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't save technology", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Edit Technology" : "New Technology"}
      submitLabel={initial ? "Save" : "Create"}
      onSubmit={submit}
      submitting={create.isPending || update.isPending}
      disabled={!name.trim()}
    >
      <TextField label="Name" value={name} onChange={setName} required placeholder="React, Node.js, Figma…" />
      <div className="space-y-1.5">
        <label className="text-sm">Color</label>
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full border-2 transition-transform ${color === c ? "scale-110 border-foreground" : "border-transparent"}`}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>
      </div>
    </FormDialog>
  );
}

export function Technologies() {
  const { toast } = useToast();
  const { data: technologies = [], isLoading, isError, error, refetch } = useTechnologies();
  const del = useDeleteTechnology();
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Technology | null>(null);
  const [toDelete, setToDelete] = useState<Technology | null>(null);

  const filtered = technologies.filter((t) => t.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (t: Technology) => { setEditing(t); setDialogOpen(true); };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await del.mutateAsync(toDelete.id);
      toast({ title: "Technology deleted", description: toDelete.name });
    } catch (e) {
      toast({ title: "Couldn't delete", description: (e as Error).message, variant: "destructive" });
    } finally {
      setToDelete(null);
    }
  };

  const columns = [
    {
      header: "Technology",
      cell: (item: Technology) => (
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color ?? "var(--color-muted-foreground)" }} />
          <span className="font-medium">{item.name}</span>
        </div>
      ),
    },
    {
      header: "",
      className: "w-[110px] text-right",
      cell: (item: Technology) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setToDelete(item)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Technologies"
        subtitle="Configure the technologies available across quotes and projects."
        actions={
          <div className="flex items-center gap-4">
            <Input placeholder="Search technologies..." className="w-[220px] bg-card border-border shadow-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            <Button className="gap-2" onClick={openCreate}><Plus className="w-4 h-4" /> Add Technology</Button>
          </div>
        }
      />

      {isLoading ? (
        <TableSkeleton columns={2} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : technologies.length === 0 ? (
        <EmptyState
          icon={<Cpu />}
          title="No technologies yet"
          description="Add the technologies your agency works with so they can be selected on quotes and projects."
          action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add your first technology</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Cpu />} title="No matches" description={`No technologies match "${searchTerm}".`} />
      ) : (
        <DataTable data={filtered} columns={columns} onRowClick={(item) => openEdit(item)} />
      )}

      <TechDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete technology?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.name} will be removed. Quotes and projects using it will keep their data but lose the link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
