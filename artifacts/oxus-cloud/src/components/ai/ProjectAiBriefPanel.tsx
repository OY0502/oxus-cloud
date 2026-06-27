import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Sparkles, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useAiProjectBriefs,
  useAiProposedTasks,
  useCreateAiProjectBrief,
  useUpdateAiProposedTaskStatus,
} from "@/hooks/api";
import type {
  AiProjectBrief,
  AiProjectBriefSourceType,
  AiProposedTask,
  AiProposedTaskStatus,
} from "@/lib/types";

const SOURCE_OPTIONS: { value: AiProjectBriefSourceType; label: string }[] = [
  { value: "manual", label: "Manual notes" },
  { value: "zoom_transcript", label: "Zoom transcript" },
  { value: "project_description", label: "Project description" },
  { value: "other", label: "Other" },
];

function sourceLabel(sourceType: AiProjectBriefSourceType) {
  return SOURCE_OPTIONS.find((option) => option.value === sourceType)?.label ?? sourceType;
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <h4 className="text-sm font-semibold mb-2">{title}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None captured.</p>
      ) : (
        <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusVariant(status: AiProposedTaskStatus) {
  if (status === "accepted") return "default";
  if (status === "rejected") return "destructive";
  return "outline";
}

function TaskCard({ task, onStatusChange, busy }: {
  task: AiProposedTask;
  onStatusChange: (task: AiProposedTask, status: AiProposedTaskStatus) => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h5 className="text-sm font-semibold">{task.title}</h5>
            <Badge variant="outline" className="capitalize">{task.priority}</Badge>
            <Badge variant={statusVariant(task.status)} className="capitalize">{task.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Confidence: {task.confidence === null ? "n/a" : `${Math.round(task.confidence * 100)}%`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            size="sm"
            variant={task.status === "accepted" ? "default" : "outline"}
            className="gap-1"
            onClick={() => onStatusChange(task, "accepted")}
            disabled={busy || task.status === "accepted"}
          >
            <Check className="h-3.5 w-3.5" /> Accept
          </Button>
          <Button
            size="sm"
            variant={task.status === "rejected" ? "destructive" : "outline"}
            className="gap-1"
            onClick={() => onStatusChange(task, "rejected")}
            disabled={busy || task.status === "rejected"}
          >
            <X className="h-3.5 w-3.5" /> Reject
          </Button>
        </div>
      </div>

      {task.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>}

      {task.acceptance_criteria.length > 0 && (
        <div>
          <h6 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Acceptance Criteria
          </h6>
          <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
            {task.acceptance_criteria.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      )}

      {task.qa_scenarios.length > 0 && (
        <div>
          <h6 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            QA Scenarios
          </h6>
          <div className="space-y-2">
            {task.qa_scenarios.map((scenario, index) => (
              <div key={`${scenario.title}-${index}`} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-medium">{scenario.title}</span>
                  <Badge variant="outline" className="capitalize">{scenario.priority}</Badge>
                </div>
                {scenario.steps.length > 0 && (
                  <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
                    {scenario.steps.map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}
                  </ol>
                )}
                <p className="text-sm text-muted-foreground mt-2">
                  <span className="font-medium text-foreground/80">Expected:</span> {scenario.expected_result}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BriefContent({
  brief,
  tasks,
  onStatusChange,
  busy,
}: {
  brief: AiProjectBrief;
  tasks: AiProposedTask[];
  onStatusChange: (task: AiProposedTask, status: AiProposedTaskStatus) => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <h4 className="text-sm font-semibold mb-2">Summary</h4>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {brief.summary || "No summary returned."}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ListSection title="Goals" items={brief.goals} />
        <ListSection title="Scope In" items={brief.scope_in} />
        <ListSection title="Scope Out" items={brief.scope_out} />
        <ListSection title="Risks" items={brief.risks} />
        <ListSection title="Open Questions" items={brief.open_questions} />
        <ListSection title="QA Notes" items={brief.qa_notes} />
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Proposed Tasks</h4>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No proposed tasks were returned for this brief.</p>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} onStatusChange={onStatusChange} busy={busy} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectAiBriefPanel({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { data: briefs = [], isLoading: briefsLoading, isError, error, refetch } = useAiProjectBriefs(projectId);
  const { data: tasks = [] } = useAiProposedTasks(projectId);
  const createBrief = useCreateAiProjectBrief();
  const updateTaskStatus = useUpdateAiProposedTaskStatus();
  const [sourceType, setSourceType] = useState<AiProjectBriefSourceType>("manual");
  const [sourceText, setSourceText] = useState("");
  const [expandedBriefId, setExpandedBriefId] = useState<string | undefined>();

  useEffect(() => {
    if (briefs.length > 0 && !expandedBriefId) setExpandedBriefId(briefs[0].id);
  }, [briefs, expandedBriefId]);

  const tasksByBrief = useMemo(() => {
    const grouped = new Map<string, AiProposedTask[]>();
    for (const task of tasks) {
      if (!task.brief_id) continue;
      grouped.set(task.brief_id, [...(grouped.get(task.brief_id) ?? []), task]);
    }
    return grouped;
  }, [tasks]);

  const generate = async () => {
    const text = sourceText.trim();
    if (!text) return;
    try {
      const result = await createBrief.mutateAsync({
        project_id: projectId,
        source_type: sourceType,
        source_text: text,
      });
      setSourceText("");
      setExpandedBriefId(result.brief.id);
      toast({ title: "AI brief generated", description: `${result.tasks.length} proposed task(s) created.` });
    } catch (e) {
      toast({ title: "AI brief failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const updateStatus = async (task: AiProposedTask, status: AiProposedTaskStatus) => {
    try {
      await updateTaskStatus.mutateAsync({ id: task.id, project_id: projectId, status });
    } catch (e) {
      toast({ title: "Couldn't update task", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Generate AI Project Brief</h3>
            <p className="text-xs text-muted-foreground">
              Paste project notes or a transcript to create a brief and proposed QA-ready tasks.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <Select value={sourceType} onValueChange={(value) => setSourceType(value as AiProjectBriefSourceType)}>
            <SelectTrigger>
              <SelectValue placeholder="Source type" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={5}
            placeholder="Paste project notes, client description, or meeting transcript..."
          />
        </div>

        {createBrief.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Generation failed</AlertTitle>
            <AlertDescription>{createBrief.error.message}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button onClick={generate} disabled={!sourceText.trim() || createBrief.isPending} className="gap-2">
            <Sparkles className="h-4 w-4" />
            {createBrief.isPending ? "Generating..." : "Generate AI Brief"}
          </Button>
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not load AI briefs</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{error.message}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : briefsLoading ? (
        <p className="text-sm text-muted-foreground">Loading AI briefs...</p>
      ) : briefs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No AI briefs yet. Generate one from manual notes or a project description to get started.
        </p>
      ) : (
        <Accordion type="single" collapsible value={expandedBriefId} onValueChange={setExpandedBriefId}>
          {briefs.map((brief, index) => (
            <AccordionItem key={brief.id} value={brief.id} className="rounded-xl border border-border px-4 mb-3">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2 flex-wrap text-left">
                  <span>{index === 0 ? "Latest brief" : "AI brief"}</span>
                  <Badge variant="outline">{sourceLabel(brief.source_type)}</Badge>
                  <Badge variant={brief.status === "completed" ? "default" : "outline"} className="capitalize">
                    {brief.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(brief.created_at).toLocaleString()}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <BriefContent
                  brief={brief}
                  tasks={tasksByBrief.get(brief.id) ?? []}
                  onStatusChange={updateStatus}
                  busy={updateTaskStatus.isPending}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
