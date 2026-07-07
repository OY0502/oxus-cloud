import React, { useState } from "react";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {

  Table,

  TableBody,

  TableCell,

  TableHead,

  TableHeader,

  TableRow,

} from "@/components/ui/table";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

import { AlertTriangle, CheckCircle2, Copy } from "lucide-react";

import { useToast } from "@/hooks/use-toast";

import { ExpandableList } from "./ExpandableList";
import { ExpandableText } from "./ExpandableText";

import { EditableMemoryBlock } from "./EditableMemoryBlock";

import {

  inferQuestionCategory,

  isActionOrientedNote,

  sourceLabel,

} from "./projectMemoryUtils";
import { formatClickupDocSourceMeta } from "./clickupDocSyncUtils";
import { isActiveKnowledgeSource, isExcludedKnowledgeSource, knowledgeSyncStatusLabel } from "@/lib/knowledgeSourceScope";

import type {

  AiProjectBrief,

  AiProposedTask,

  ProjectKnowledgeSource,

  ProjectKnowledgeChunk,

  ProjectPmProfile,

} from "@/lib/types";

import { formatDistanceToNow } from "date-fns";

import { cn } from "@/lib/utils";



interface Props {

  projectId: string;

  profile: ProjectPmProfile | null;

  sources: ProjectKnowledgeSource[];

  chunks: ProjectKnowledgeChunk[];

  briefs: AiProjectBrief[];

  tasks: AiProposedTask[];

  briefsLoading: boolean;

  briefsError: boolean;

  onBriefRetry: () => void;

}



const CHIP_COLORS = [

  "bg-soft-violet/12 text-soft-violet border-soft-violet/25",

  "bg-mint/15 text-deep-teal border-mint/30",

  "bg-periwinkle/15 text-primary border-periwinkle/30",

  "bg-logo-blue/40 text-primary border-periwinkle/20",

] as const;

const SCOPE_IN_CHIP = "bg-soft-green/15 text-deep-teal border-soft-green/35";
const SCOPE_OUT_CHIP = "bg-soft-red/10 text-soft-red border-soft-red/30";
const NEUTRAL_CHIP = "bg-muted/50 text-foreground border-border";



function ColoredChips({

  items,

  emptyLabel,

  variant = "default",

}: {

  items: string[];

  emptyLabel: string;

  variant?: "default" | "scope-in" | "scope-out" | "neutral";

}) {

  const [expanded, setExpanded] = useState(false);

  const initialCount = 6;

  if (items.length === 0) return <p className="text-sm text-cool-slate italic">{emptyLabel}</p>;

  const visible = expanded ? items : items.slice(0, initialCount);

  const chipClass =

    variant === "scope-in"

      ? SCOPE_IN_CHIP

      : variant === "scope-out"

        ? SCOPE_OUT_CHIP

        : variant === "neutral"

          ? NEUTRAL_CHIP

          : null;

  return (

    <div>

      <div className="flex flex-wrap gap-1.5">

        {visible.map((item, i) => (

          <span

            key={i}

            className={cn(

              "text-sm font-medium rounded-md px-2.5 py-1 border",

              chipClass ?? CHIP_COLORS[i % CHIP_COLORS.length],

            )}

          >

            {item}

          </span>

        ))}

      </div>

      {items.length > initialCount && (

        <Button variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs text-periwinkle" onClick={() => setExpanded((v) => !v)}>

          {expanded ? "Show less" : "Show more"}

        </Button>

      )}

    </div>

  );

}



function NumberedList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {

  if (items.length === 0) return <p className="text-sm text-cool-slate italic">{emptyLabel}</p>;

  return (

    <ExpandableList

      items={items}

      emptyLabel={emptyLabel}

      renderItem={(item, i) => (

        <div key={i} className="flex gap-2.5 text-sm text-foreground/90">

          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-periwinkle/15 text-[11px] font-semibold text-periwinkle">

            {i + 1}

          </span>

          <span className="pt-0.5">{item}</span>

        </div>

      )}

    />

  );

}



function SuccessCriteriaList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {

  if (items.length === 0) return <p className="text-sm text-cool-slate italic">{emptyLabel}</p>;

  return (

    <ExpandableList

      items={items}

      emptyLabel={emptyLabel}

      renderItem={(item, i) => (

        <div key={i} className="flex gap-2 text-sm text-foreground/90">

          <CheckCircle2 className="h-4 w-4 shrink-0 text-deep-teal mt-0.5" />

          <span>{item}</span>

        </div>

      )}

    />

  );

}



function OpenQuestionsTable({ projectId, questions }: { projectId: string; questions: string[] }) {

  const { toast } = useToast();

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);



  const copyAll = async () => {

    if (questions.length === 0) return;

    try {

      await navigator.clipboard.writeText(questions.map((q, i) => `${i + 1}. ${q}`).join("\n"));

      toast({ title: "Copied", description: `${questions.length} question(s) copied to clipboard.` });

    } catch {

      toast({ title: "Copy failed", variant: "destructive" });

    }

  };



  const copyOne = async (question: string, index: number) => {

    try {

      await navigator.clipboard.writeText(question);

      setCopiedIndex(index);

      window.setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 2000);

    } catch {

      toast({ title: "Copy failed", variant: "destructive" });

    }

  };



  if (questions.length === 0) {

    return (

      <EditableMemoryBlock

        projectId={projectId}

        title="Open Questions"

        field="open_questions"

        value={questions}

        type="list"

        emptyLabel="No open questions captured."

      />

    );

  }



  return (

    <EditableMemoryBlock

      projectId={projectId}

      title="Open Questions"

      field="open_questions"

      value={questions}

      type="list"

      emptyLabel="No open questions captured."

    >

      <div className="space-y-2">

        <div className="flex justify-end">

          <Button variant="outline" size="sm" className="gap-1 h-7 text-xs border-periwinkle/30" onClick={copyAll}>

            <Copy className="h-3 w-3" /> Copy questions

          </Button>

        </div>

        <div className="rounded-lg border border-border overflow-hidden">

          <Table>

            <TableHeader>

              <TableRow className="hover:bg-transparent bg-muted/30">

                <TableHead className="h-8 text-xs text-cool-slate">Question</TableHead>

                <TableHead className="h-8 text-xs w-[100px] text-cool-slate">Category</TableHead>

                <TableHead className="h-8 text-xs w-[80px] text-cool-slate">Status</TableHead>

                <TableHead className="h-8 text-xs w-[72px] text-cool-slate" />

              </TableRow>

            </TableHeader>

            <TableBody>

              {questions.map((q, i) => {

                const category = inferQuestionCategory(q);

                return (

                  <TableRow key={i}>

                    <TableCell className="text-sm py-2 align-top">{q}</TableCell>

                    <TableCell className="py-2 align-top">

                      {category ? (

                        <Badge variant="outline" className="text-[10px] border-periwinkle/30 bg-periwinkle/10">

                          {category}

                        </Badge>

                      ) : (

                        "—"

                      )}

                    </TableCell>

                    <TableCell className="py-2 align-top">

                      <Badge variant="secondary" className="text-[10px] bg-amber/15 text-amber border-amber/30">

                        Open

                      </Badge>

                    </TableCell>

                    <TableCell className="py-2 align-top text-right">

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => void copyOne(q, i)}
                      >
                        <Copy className="h-3 w-3" />
                        {copiedIndex === i ? "Copied" : "Copy"}
                      </Button>

                    </TableCell>

                  </TableRow>

                );

              })}

            </TableBody>

          </Table>

        </div>

      </div>

    </EditableMemoryBlock>

  );

}



function AssumptionsList({ projectId, items }: { projectId: string; items: string[] }) {

  return (

    <EditableMemoryBlock

      projectId={projectId}

      title="Assumptions"

      field="assumptions"

      value={items}

      type="list"

      emptyLabel="No assumptions captured yet."

    >

      {items.length === 0 ? (

        <p className="text-sm text-cool-slate italic">No assumptions captured yet.</p>

      ) : (

        <ExpandableList

          items={items}

          renderItem={(item, i) => (

            <div key={i} className="flex gap-2 rounded-md border border-amber/25 bg-amber/[0.06] px-3 py-2">

              <AlertTriangle className="h-3.5 w-3.5 text-amber shrink-0 mt-0.5" />

              <div className="min-w-0 space-y-1">

                <Badge variant="outline" className="text-[10px] border-amber/30 text-amber bg-amber/10">

                  Needs confirmation

                </Badge>

                <p className="text-sm text-foreground/85">{item}</p>

              </div>

            </div>

          )}

        />

      )}

    </EditableMemoryBlock>

  );

}



function DeliverySignalsList({ projectId, items }: { projectId: string; items: string[] }) {

  return (

    <EditableMemoryBlock

      projectId={projectId}

      title="PM Notes / Delivery Signals"

      field="delivery_notes"

      value={items}

      type="list"

      emptyLabel="No delivery signals captured yet."

    >

      {items.length === 0 ? (

        <p className="text-sm text-cool-slate italic">No delivery signals captured yet.</p>

      ) : (

        <ExpandableList

          items={items}

          renderItem={(item, i) => {

            const action = isActionOrientedNote(item);

            return (

              <div

                key={i}

                className={cn(

                  "rounded-md border px-3 py-2 text-sm",

                  action

                    ? "border-deep-teal/30 bg-deep-teal/[0.06] text-foreground/90"

                    : "border-border/60 bg-muted/20 text-muted-foreground",

                )}

              >

                {action && (

                  <Badge className="mb-1 text-[10px] h-5 bg-deep-teal text-white border-0">Action signal</Badge>

                )}

                <p>{item}</p>

              </div>

            );

          }}

        />

      )}

    </EditableMemoryBlock>

  );

}



function BriefHistoryItem({ brief, taskCount }: { brief: AiProjectBrief; taskCount: number }) {

  return (

    <AccordionItem value={brief.id} className="border border-border rounded-lg px-3 mb-2">

      <AccordionTrigger className="hover:no-underline py-3">

        <div className="flex items-center gap-2 flex-wrap text-left">

          <span className="text-sm font-medium">{sourceLabel(brief.source_type)}</span>

          <Badge variant={brief.status === "completed" ? "default" : "outline"} className="capitalize text-[10px]">

            {brief.status}

          </Badge>

          <span className="text-xs text-cool-slate">

            {formatDistanceToNow(new Date(brief.created_at), { addSuffix: true })}

          </span>

          <span className="text-xs text-cool-slate">· {taskCount} task(s)</span>

        </div>

      </AccordionTrigger>

      <AccordionContent className="space-y-3 pb-3">

        {brief.summary && (
          <ExpandableText text={brief.summary} maxLines={3} emptyLabel="" />
        )}

      </AccordionContent>

    </AccordionItem>

  );

}



const tabTriggerClass = "tab-trigger-underline text-xs sm:text-sm";

export function ProjectMemoryTabs({

  projectId,

  profile,

  sources,

  chunks,

  briefs,

  tasks,

  briefsLoading,

  briefsError,

  onBriefRetry,

}: Props) {

  const activeSources = React.useMemo(
    () => sources.filter((s) => isActiveKnowledgeSource(s)),
    [sources],
  );
  const excludedSources = React.useMemo(
    () => sources.filter((s) => isExcludedKnowledgeSource(s)),
    [sources],
  );
  const [showExcludedSources, setShowExcludedSources] = React.useState(false);

  if (!profile) return null;



  const pendingTasks = tasks.filter((t) => t.status === "pending");

  return (

    <Tabs defaultValue="overview" className="w-full">

      <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b border-border bg-transparent p-0">

        <TabsTrigger value="overview" className={tabTriggerClass}>Overview</TabsTrigger>

        <TabsTrigger value="scope" className={tabTriggerClass}>Scope</TabsTrigger>

        <TabsTrigger value="risks" className={tabTriggerClass}>Risks & Questions</TabsTrigger>

        <TabsTrigger value="delivery" className={tabTriggerClass}>Delivery</TabsTrigger>

        <TabsTrigger value="sources" className={tabTriggerClass}>Sources / History</TabsTrigger>

      </TabsList>



      <TabsContent value="overview" className="mt-5">

        <div className="grid gap-4 lg:grid-cols-2">

          <div className="space-y-4">

            <EditableMemoryBlock

              projectId={projectId}

              title="Business Goal"

              field="business_goal"

              value={profile.business_goal}

              type="text"

              emptyLabel="No business goal captured yet."

            >

              <ExpandableText
                text={profile.business_goal}
                maxLines={4}
                emptyLabel="No business goal captured yet."
              />

            </EditableMemoryBlock>



            <EditableMemoryBlock

              projectId={projectId}

              title="Target Users"

              field="target_users"

              value={profile.target_users}

              type="list"

              emptyLabel="No target users captured yet."

            >

              <ColoredChips items={profile.target_users} emptyLabel="No target users captured yet." variant="neutral" />

            </EditableMemoryBlock>



            <EditableMemoryBlock

              projectId={projectId}

              title="Core Flows"

              field="core_flows"

              value={profile.core_flows}

              type="list"

              emptyLabel="No core flows captured yet."

            >

              <NumberedList items={profile.core_flows} emptyLabel="No core flows captured yet." />

            </EditableMemoryBlock>

          </div>



          <div className="space-y-4">

            <EditableMemoryBlock

              projectId={projectId}

              title="Success Criteria"

              field="success_criteria"

              value={profile.success_criteria}

              type="list"

              variant="success"

              emptyLabel="No success criteria captured yet."

            >

              <SuccessCriteriaList items={profile.success_criteria} emptyLabel="No success criteria captured yet." />

            </EditableMemoryBlock>



            <EditableMemoryBlock

              projectId={projectId}

              title="QA Strategy"

              field="qa_strategy"

              value={profile.qa_strategy}

              type="text"

              emptyLabel="No QA strategy captured yet."

            >

              <ExpandableText
                text={profile.qa_strategy}
                maxLines={4}
                emptyLabel="No QA strategy captured yet."
              />

              {profile.qa_strategy?.trim() && (

                <Badge variant="outline" className="mt-2 text-[10px] border-cool-slate/30 text-cool-slate">

                  Automated + Manual

                </Badge>

              )}

            </EditableMemoryBlock>

          </div>

        </div>

      </TabsContent>



      <TabsContent value="scope" className="mt-5 space-y-4">

        <div className="grid gap-4 lg:grid-cols-2">

          <EditableMemoryBlock

            projectId={projectId}

            title="Scope In"

            field="scope_in"

            value={profile.scope_in}

            type="list"

            emptyLabel="No scope-in items captured yet."

          >

            <ColoredChips items={profile.scope_in} emptyLabel="No scope-in items captured yet." variant="scope-in" />

          </EditableMemoryBlock>



          <EditableMemoryBlock

            projectId={projectId}

            title="Scope Out"

            field="scope_out"

            value={profile.scope_out}

            type="list"

            emptyLabel="No scope-out items captured yet."

          >

            <ColoredChips items={profile.scope_out} emptyLabel="No scope-out items captured yet." variant="scope-out" />

          </EditableMemoryBlock>

        </div>



        <EditableMemoryBlock

          projectId={projectId}

          title="Technical Notes"

          field="technical_notes"

          value={profile.technical_notes}

          type="list"

          emptyLabel="No technical notes captured yet."

        >

          <NumberedList items={profile.technical_notes} emptyLabel="No technical notes captured yet." />

        </EditableMemoryBlock>



        <EditableMemoryBlock

          projectId={projectId}

          title="Constraints"

          field="constraints"

          value={profile.constraints}

          type="list"

          emptyLabel="No constraints captured yet."

        >

          <NumberedList items={profile.constraints} emptyLabel="No constraints captured yet." />

        </EditableMemoryBlock>

      </TabsContent>



      <TabsContent value="risks" className="mt-5 space-y-4">

        <EditableMemoryBlock

          projectId={projectId}

          title="Risks"

          field="risks"

          value={profile.risks}

          type="list"

          emptyLabel="No major risks captured yet."

        >

          {profile.risks.length === 0 ? (

            <p className="text-sm text-cool-slate italic">No major risks captured yet.</p>

          ) : (

            <ExpandableList

              items={profile.risks}

              renderItem={(item, i) => (

                <p key={i} className="text-sm text-foreground/90 pl-3 border-l-2 border-soft-red/40">

                  {item}

                </p>

              )}

            />

          )}

        </EditableMemoryBlock>



        <OpenQuestionsTable projectId={projectId} questions={profile.open_questions} />

        <AssumptionsList projectId={projectId} items={profile.assumptions} />

      </TabsContent>



      <TabsContent value="delivery" className="mt-5 space-y-4">

        {profile.current_phase && (

          <EditableMemoryBlock

            projectId={projectId}

            title="Current Phase"

            field="current_phase"

            value={profile.current_phase}

            type="text"

            aiMemory={false}

          >

            <Badge variant="outline" className="border-periwinkle/40 bg-periwinkle/10 text-primary">

              {profile.current_phase}

            </Badge>

          </EditableMemoryBlock>

        )}



        <DeliverySignalsList projectId={projectId} items={profile.delivery_notes} />

        <div className="rounded-xl border border-card-border bg-muted/20 px-4 py-3">

          <h4 className="section-label mb-1">

            Proposed Tasks Summary

          </h4>

          <p className="text-sm text-foreground/85">

            <span className="font-medium text-amber">{pendingTasks.length} pending</span>

            {" · "}

            {tasks.filter((t) => t.status === "accepted").length} accepted

            {" · "}

            {tasks.length} total

          </p>

        </div>

      </TabsContent>



      <TabsContent value="sources" className="mt-5 space-y-4">

        {activeSources.length > 0 && (

          <div className="rounded-xl border border-card-border bg-card shadow-soft overflow-hidden">

            <div className="px-4 py-2.5 border-b border-border/60 bg-muted/30">

              <h4 className="section-label">

                Knowledge Sources ({activeSources.length} active)

              </h4>

            </div>

            <div className="p-3 space-y-2">

              {activeSources.map((s) => {
                const clickupMeta = s.source_type === "clickup_doc" ? formatClickupDocSourceMeta(s) : null;
                const sourceChunks = chunks.filter((c) => c.source_id === s.id);
                const embeddedCount = sourceChunks.filter((c) => c.embedded_at).length;
                const isWebsite = s.source_type === "company_website" || s.source_type === "company_website_page";
                const websiteMeta = (s.metadata ?? {}) as Record<string, unknown>;
                const websiteUrl = isWebsite
                  ? (typeof websiteMeta.source_url === "string" ? websiteMeta.source_url : s.external_id) ?? null
                  : null;
                const syncedAt = isWebsite
                  ? (s.last_synced_at ?? (typeof websiteMeta.synced_at === "string" ? websiteMeta.synced_at : s.created_at))
                  : (clickupMeta?.syncedAt ?? s.created_at);

                return (
                <div
                  key={s.id}
                  className="rounded-md border border-border/60 bg-muted/15 px-3 py-2 flex flex-wrap items-center gap-2"
                >
                  <Badge variant="outline" className="text-[10px] border-soft-violet/30 bg-soft-violet/10 text-soft-violet">
                    {sourceLabel(s.source_type)}
                  </Badge>
                  <span className="text-sm">{s.source_title ?? "Untitled source"}</span>
                  {isWebsite && websiteUrl && (
                    <a
                      href={websiteUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[10px] text-logo-blue underline underline-offset-2 max-w-[220px] truncate"
                      title={websiteUrl}
                    >
                      {websiteUrl}
                    </a>
                  )}
                  {clickupMeta?.parent && (
                    <Badge variant="secondary" className="text-[10px]">
                      {clickupMeta.parent}
                    </Badge>
                  )}
                  {clickupMeta?.contentHash && (
                    <span className="text-[10px] text-cool-slate font-mono" title="Content hash prefix">
                      hash:{clickupMeta.contentHash}
                      {clickupMeta.changed ? " · changed" : ""}
                    </span>
                  )}
                  {sourceChunks.length > 0 && (
                    <span className="text-[10px] text-cool-slate">
                      {sourceChunks.length} chunk{sourceChunks.length === 1 ? "" : "s"}
                      {embeddedCount > 0 ? ` · ${embeddedCount} embedded` : " · not embedded"}
                    </span>
                  )}
                  <span className="text-xs text-cool-slate ml-auto">
                    {formatDistanceToNow(new Date(syncedAt), { addSuffix: true })}
                    {s.char_count ? ` · ${s.char_count.toLocaleString()} chars` : ""}
                  </span>
                </div>
              );})}

            </div>

          </div>

        )}

        {excludedSources.length > 0 && (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 overflow-hidden">
            <button
              type="button"
              className="w-full px-4 py-2.5 text-left text-xs text-cool-slate hover:bg-muted/20"
              onClick={() => setShowExcludedSources((v) => !v)}
            >
              {showExcludedSources ? "Hide" : "Show"} excluded sources ({excludedSources.length} out of scope / unknown)
            </button>
            {showExcludedSources && (
              <div className="p-3 space-y-2 border-t border-border/60">
                {excludedSources.map((s) => {
                  const clickupMeta = s.source_type === "clickup_doc" ? formatClickupDocSourceMeta(s) : null;
                  return (
                    <div
                      key={s.id}
                      className="rounded-md border border-soft-red/20 bg-soft-red/5 px-3 py-2 flex flex-wrap items-center gap-2 opacity-80"
                    >
                      <Badge variant="outline" className="text-[10px]">
                        {knowledgeSyncStatusLabel(s.sync_status ?? "out_of_scope")}
                      </Badge>
                      <span className="text-sm line-through decoration-cool-slate/40">{s.source_title ?? "Untitled"}</span>
                      {clickupMeta?.parent && (
                        <Badge variant="secondary" className="text-[10px]">{clickupMeta.parent}</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeSources.length === 0 && excludedSources.length === 0 && (
          <p className="text-sm text-cool-slate italic px-1">No knowledge sources yet.</p>
        )}



        <div className="rounded-xl border border-card-border bg-card shadow-soft overflow-hidden">

          <div className="px-4 py-2.5 border-b border-border/60 bg-muted/30">

            <h4 className="section-label">Brief History</h4>

          </div>

          <div className="p-3">

            {briefsError ? (

              <div className="space-y-2">

                <p className="text-sm text-destructive">Could not load brief history.</p>

                <Button size="sm" variant="outline" onClick={onBriefRetry}>Retry</Button>

              </div>

            ) : briefsLoading ? (

              <p className="text-sm text-cool-slate">Loading…</p>

            ) : briefs.length === 0 ? (

              <p className="text-sm text-cool-slate italic">No brief history yet.</p>

            ) : (

              <Accordion type="single" collapsible>

                {briefs.map((brief) => (

                  <BriefHistoryItem

                    key={brief.id}

                    brief={brief}

                    taskCount={tasks.filter((t) => t.brief_id === brief.id).length}

                  />

                ))}

              </Accordion>

            )}

          </div>

        </div>

      </TabsContent>

    </Tabs>

  );

}

