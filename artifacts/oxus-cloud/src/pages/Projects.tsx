import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { DndContext, closestCorners, PointerSensor, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ProjectHealthBadge } from "@/components/ProjectHealthBadge";
import { AvatarStack } from "@/components/AvatarStack";
import { KanbanColumn } from "@/components/KanbanColumn";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, LayoutGrid, List, CalendarDays, Briefcase } from "lucide-react";
import { useProjects, useUpdateProject } from "@/hooks/api";
import { PmCommandCenterSection } from "@/components/pm/PmCommandCenterSection";
import { ProjectThumbnail } from "@/components/projects/ProjectThumbnail";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/states/QueryStates";
import type { ProjectStatus, ProjectWithAssignees } from "@/lib/types";
import { contactInitials } from "@/lib/contacts";
import { formatEUR } from "@/lib/currency";

const STATUS_COLUMNS: { id: ProjectStatus; title: string; description: string }[] = [
  { id: "planning", title: "Planning", description: "Not started yet" },
  { id: "in-progress", title: "In Progress", description: "Actively being delivered" },
  { id: "on-hold", title: "On Hold", description: "Paused" },
  { id: "completed", title: "Completed", description: "Delivered" },
];

function avatarUrls(p: ProjectWithAssignees): string[] {
  return p.team_contacts.map(() => "");
}

function avatarInitials(p: ProjectWithAssignees): string[] {
  return p.team_contacts.map((c) => contactInitials(c.name));
}

function DraftBadge() {
  return <Badge variant="outline" className="border-warm-yellow/40 bg-warm-yellow/10 text-warm-yellow text-[10px] uppercase">Draft</Badge>;
}

function ProjectCard({ p }: { p: ProjectWithAssignees }) {
  return (
    <Card className="mb-3 hover-elevate">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <ProjectThumbnail name={p.name} imagePath={p.image_path} size="sm" />
          <div className="flex items-start justify-between gap-2 flex-1 min-w-0">
            <div className="min-w-0">
              <h4 className="font-semibold text-sm truncate">{p.name}</h4>
              <p className="text-xs text-muted-foreground truncate">{p.client_name ?? "—"}</p>
            </div>
            {p.is_draft && <DraftBadge />}
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{p.progress}%</span>
            <span className="font-medium text-foreground">{formatEUR(p.budget)}</span>
          </div>
          <Progress value={p.progress} className="h-1.5" />
        </div>
        <div className="flex items-center justify-between">
          {p.team_contacts.length ? <AvatarStack urls={avatarUrls(p)} fallbacks={avatarInitials(p)} size="sm" /> : <span className="text-xs text-muted-foreground">Unassigned</span>}
          <ProjectHealthBadge health={p.health} />
        </div>
      </CardContent>
    </Card>
  );
}

function SortableProjectCard({ p, onClick }: { p: ProjectWithAssignees; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: p.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick} className="cursor-grab active:cursor-grabbing">
      <ProjectCard p={p} />
    </div>
  );
}

function Timeline({ projects, onSelect }: { projects: ProjectWithAssignees[]; onSelect: (p: ProjectWithAssignees) => void }) {
  const t = (iso: string) => new Date(iso).getTime();
  // A project is on the timeline if it has at least a start date or a deadline.
  const dated = projects.filter((p) => p.start_date || p.deadline);

  const range = useMemo(() => {
    if (dated.length === 0) return null;
    const times: number[] = [];
    for (const p of dated) {
      if (p.start_date) times.push(t(p.start_date));
      if (p.deadline) times.push(t(p.deadline));
      // Deadline-only projects start from their creation date.
      if (!p.start_date && p.deadline) times.push(t(p.created_at));
    }
    const min = Math.min(...times);
    const max = Math.max(...times);
    return { min, max, span: Math.max(1, max - min) };
  }, [dated]);

  if (!range) {
    return <EmptyState icon={<CalendarDays />} title="No scheduled projects" description="Projects with a start date or a deadline will appear on the timeline." />;
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        {dated.map((p) => {
          // Resolve the bar's start/end and rendering mode.
          let startMs: number;
          let endMs: number;
          let infinite = false; // start, no deadline → extends to the edge
          let fromCreation = false; // deadline, no start → line from creation date

          if (p.start_date && p.deadline) {
            startMs = t(p.start_date);
            endMs = t(p.deadline);
          } else if (p.start_date && !p.deadline) {
            startMs = t(p.start_date);
            endMs = range.max;
            infinite = true;
          } else {
            startMs = t(p.created_at);
            endMs = t(p.deadline!);
            fromCreation = true;
          }

          const left = ((startMs - range.min) / range.span) * 100;
          const width = Math.max(2, ((endMs - startMs) / range.span) * 100);

          const rangeLabel = infinite
            ? `${fmt(p.start_date!)} → Ongoing`
            : fromCreation
              ? `${fmt(p.created_at)} → ${fmt(p.deadline!)}`
              : `${fmt(p.start_date!)} → ${fmt(p.deadline!)}`;

          return (
            <button key={p.id} onClick={() => onSelect(p)} className="w-full text-left group">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium truncate">{p.name}</span>
                {p.is_draft && <DraftBadge />}
                {infinite && <Badge variant="outline" className="text-[10px] uppercase">Ongoing</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">{rangeLabel}</span>
              </div>
              <div className="relative h-6 rounded-md bg-muted/40">
                <div
                  className={
                    "absolute top-0 h-6 rounded-md transition-colors flex items-center px-2 " +
                    (fromCreation
                      ? "bg-primary/40 group-hover:bg-primary/60 border border-dashed border-primary/60"
                      : "bg-primary/70 group-hover:bg-primary") +
                    (infinite ? " bg-gradient-to-r from-primary/70 to-primary/20 group-hover:from-primary" : "")
                  }
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  <span className="text-[10px] font-medium text-primary-foreground">{p.progress}%</span>
                </div>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function Projects() {
  const [, navigate] = useLocation();
  const [view, setView] = useState("table");
  const { data: projects = [], isLoading, isError, error, refetch } = useProjects();
  const updateProject = useUpdateProject();
  const [boardItems, setBoardItems] = useState<ProjectWithAssignees[]>([]);

  useEffect(() => { setBoardItems(projects); }, [projects]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const columnIds = useMemo(() => STATUS_COLUMNS.map((c) => c.id) as string[], []);

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

  const columns = [
    {
      header: "",
      className: "w-[52px]",
      cell: (item: ProjectWithAssignees) => (
        <ProjectThumbnail name={item.name} imagePath={item.image_path} size="sm" />
      ),
    },
    {
      header: "Project Name",
      className: "min-w-[200px]",
      cell: (item: ProjectWithAssignees) => (
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">{item.name}</span>
            {item.is_draft && <DraftBadge />}
          </div>
          <span className="text-xs text-muted-foreground mt-0.5 truncate">{item.client_name ?? "—"}</span>
        </div>
      ),
    },
    { header: "Status", cell: (item: ProjectWithAssignees) => <StatusBadge status={item.status.replace("-", " ")} /> },
    {
      header: "Priority",
      cell: (item: ProjectWithAssignees) => (
        <Badge variant={item.priority === "high" ? "destructive" : item.priority === "medium" ? "secondary" : "outline"} className="capitalize">{item.priority}</Badge>
      ),
    },
    {
      header: "Assignees",
      cell: (item: ProjectWithAssignees) => (item.team_contacts.length ? <AvatarStack urls={avatarUrls(item)} fallbacks={avatarInitials(item)} size="sm" /> : <span className="text-xs text-muted-foreground">Unassigned</span>),
    },
    {
      header: "Timeline",
      className: "w-[250px]",
      cell: (item: ProjectWithAssignees) => (
        <div className="flex flex-col gap-1.5 w-full max-w-[200px]">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{fmt(item.start_date)}</span>
            <span className="font-medium text-foreground">{item.progress}%</span>
            <span>{fmt(item.deadline)}</span>
          </div>
          <Progress value={item.progress} className="h-1.5" />
        </div>
      ),
    },
    { header: "Budget", cell: (item: ProjectWithAssignees) => <span className="font-medium">{formatEUR(item.budget)}</span> },
    { header: "Health", cell: (item: ProjectWithAssignees) => <ProjectHealthBadge health={item.health} /> },
  ];

  const handleDragOver = (event: any) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    setBoardItems((prev) => {
      const resolve = (id: string) => (columnIds.includes(id) ? id : prev.find((i) => i.id === id)?.status ?? null);
      const sourceCol = resolve(activeId);
      const targetCol = resolve(overId);
      if (!sourceCol || !targetCol || sourceCol === targetCol) return prev;
      return prev.map((item) => (item.id === activeId ? { ...item, status: targetCol as ProjectStatus } : item));
    });
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over) return;
    const moved = boardItems.find((i) => i.id === active.id);
    const original = projects.find((i) => i.id === active.id);
    if (moved && original && moved.status !== original.status) {
      updateProject.mutate({ id: moved.id, patch: { status: moved.status } });
    }
    if (active.id !== over.id) {
      setBoardItems((prev) => {
        const a = prev.findIndex((i) => i.id === active.id);
        const b = prev.findIndex((i) => i.id === over.id);
        if (a === -1 || b === -1) return prev;
        return arrayMove(prev, a, b);
      });
    }
  };

  const openProject = (p: ProjectWithAssignees) => navigate(`/projects/${p.id}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        subtitle="Command center for all active and upcoming projects."
        actions={<Button className="gap-2" onClick={() => navigate("/projects/new")}><Plus className="h-4 w-4" /> New Project</Button>}
      />

      <PmCommandCenterSection />

      <Tabs value={view} onValueChange={setView} className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList className="bg-muted/50 p-1 border border-border">
            <TabsTrigger value="table" className="gap-2"><List className="h-4 w-4" /> Table</TabsTrigger>
            <TabsTrigger value="board" className="gap-2"><LayoutGrid className="h-4 w-4" /> Board</TabsTrigger>
            <TabsTrigger value="timeline" className="gap-2"><CalendarDays className="h-4 w-4" /> Timeline</TabsTrigger>
          </TabsList>
        </div>

        {isLoading ? (
          <TableSkeleton columns={8} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<Briefcase />}
            title="No projects yet"
            description="Spin up your first project to track delivery, timelines, and team workload."
            action={<Button onClick={() => navigate("/projects/new")}><Plus className="h-4 w-4 mr-2" />New Project</Button>}
          />
        ) : (
          <>
            <TabsContent value="table" className="m-0 border-none p-0 outline-none">
              <DataTable data={projects} columns={columns} onRowClick={openProject} />
            </TabsContent>

            <TabsContent value="board" className="m-0 border-none p-0 outline-none">
              <div className="overflow-x-auto pb-4">
                <div className="flex gap-4 min-w-max h-[calc(100vh-18rem)]">
                  <DndContext sensors={sensors} collisionDetection={closestCorners} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
                    {STATUS_COLUMNS.map((col) => {
                      const colItems = boardItems.filter((p) => p.status === col.id);
                      return (
                        <KanbanColumn key={col.id} column={col} items={colItems}>
                          {colItems.map((p) => (
                            <SortableProjectCard key={p.id} p={p} onClick={() => openProject(p)} />
                          ))}
                        </KanbanColumn>
                      );
                    })}
                  </DndContext>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="timeline" className="m-0 border-none p-0 outline-none">
              <Timeline projects={projects} onSelect={openProject} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
