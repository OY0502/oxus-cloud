import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, MessageSquare, SkipForward, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useAnswerPmAttentionItem,
  useClearPmAttentionItem,
  useProjectPmAttentionItems,
  useSkipPmAttentionItem,
} from "@/hooks/api";
import type { ProjectPmAttentionItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  onUseIntake?: (context: string) => void;
}

function AttentionItemRow({
  item,
  projectId,
  onUseIntake,
}: {
  item: ProjectPmAttentionItem;
  projectId: string;
  onUseIntake?: (context: string) => void;
}) {
  const { toast } = useToast();
  const skip = useSkipPmAttentionItem();
  const clear = useClearPmAttentionItem();
  const answer = useAnswerPmAttentionItem();
  const [answering, setAnswering] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const busy = skip.isPending || clear.isPending || answer.isPending;

  const handleSkip = async () => {
    try {
      await skip.mutateAsync({ id: item.id, project_id: projectId });
    } catch (e) {
      toast({ title: "Could not skip", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleClear = async () => {
    try {
      await clear.mutateAsync({ id: item.id, project_id: projectId });
    } catch (e) {
      toast({ title: "Could not clear", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleAnswer = async () => {
    const text = answerText.trim();
    if (!text) return;
    try {
      await answer.mutateAsync({ id: item.id, project_id: projectId, answer_text: text });
      setAnswerText("");
      setAnswering(false);
      toast({ title: "Answer processed", description: "Memory updated from your clarification." });
    } catch (e) {
      toast({ title: "Could not process answer", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <li className="rounded-lg border border-amber/30 bg-amber/[0.04] px-3 py-2.5 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground/90">{item.question}</p>
          {item.reason && <p className="text-xs text-muted-foreground">{item.reason}</p>}
          <div className="flex flex-wrap gap-1">
            {item.importance === "high" && (
              <Badge variant="outline" className="text-[10px] border-amber/40 text-amber">High priority</Badge>
            )}
            {item.blocks_task_creation && (
              <Badge variant="outline" className="text-[10px] border-soft-red/30 text-soft-red">Blocks tasks</Badge>
            )}
          </div>
        </div>
      </div>

      {answering ? (
        <div className="space-y-2 pl-6">
          <Textarea
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            rows={2}
            placeholder="Your answer or added context…"
            className="text-sm"
            autoFocus
          />
          <div className="flex gap-1 flex-wrap">
            <Button size="sm" className="h-7 text-xs" onClick={handleAnswer} disabled={!answerText.trim() || busy}>
              Submit answer
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAnswering(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1 flex-wrap pl-6">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => setAnswering(true)}
            disabled={busy}
          >
            <MessageSquare className="h-3 w-3" /> Answer
          </Button>
          {onUseIntake && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() =>
                onUseIntake(`Re: "${item.question}"\n\n`)
              }
              disabled={busy}
            >
              Use intake box
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleSkip} disabled={busy}>
            <SkipForward className="h-3 w-3" /> Skip
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={handleClear} disabled={busy}>
            <X className="h-3 w-3" /> Clear
          </Button>
        </div>
      )}
    </li>
  );
}

function ResolvedItemRow({ item }: { item: ProjectPmAttentionItem }) {
  const resolvedAt = item.resolved_at ? new Date(item.resolved_at).toLocaleDateString() : null;
  return (
    <li className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 space-y-1">
      <p className="text-xs font-medium text-muted-foreground line-through">{item.question}</p>
      {item.resolution_summary && (
        <p className="text-xs text-foreground/80">{item.resolution_summary}</p>
      )}
      {item.resolution_evidence && (
        <p className="text-[11px] text-muted-foreground italic">Evidence: {item.resolution_evidence}</p>
      )}
      {resolvedAt && <p className="text-[10px] text-muted-foreground">Resolved {resolvedAt}</p>}
    </li>
  );
}

export function NeedsPmAttentionPanel({ projectId, onUseIntake }: Props) {
  const { data: items = [] } = useProjectPmAttentionItems(projectId);
  const openItems = items.filter((i) => i.status === "open");
  const resolvedItems = items.filter((i) => i.status === "resolved");
  const [showResolved, setShowResolved] = useState(false);

  if (openItems.length === 0 && resolvedItems.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-amber/40 bg-amber/[0.05] overflow-hidden",
        "border-l-4 border-l-amber",
      )}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber/20 bg-amber/[0.04]">
        <AlertTriangle className="h-4 w-4 text-amber" />
        <h4 className="section-label text-amber">
          Needs PM Attention
        </h4>
        <Badge variant="outline" className="ml-auto text-[10px] border-amber/40 text-amber">
          {openItems.length} open
        </Badge>
      </div>
      {openItems.length > 0 && (
        <ul className="p-3 space-y-2">
          {openItems.map((item) => (
            <AttentionItemRow key={item.id} item={item} projectId={projectId} onUseIntake={onUseIntake} />
          ))}
        </ul>
      )}

      {resolvedItems.length > 0 && (
        <div className="border-t border-amber/15 px-3 py-2">
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showResolved ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Resolved questions ({resolvedItems.length})
          </button>
          {showResolved && (
            <ul className="mt-2 space-y-2">
              {resolvedItems.map((item) => (
                <ResolvedItemRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
