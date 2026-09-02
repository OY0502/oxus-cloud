import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  CalendarDays,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Database,
  FileText,
  ListChecks,
  Loader2,
  Paperclip,
  Plus,
  Send,
  MessagesSquare,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  uploadProjectAgentIntakeFile,
  useAgentToolRuns,
  useConfirmAgentToolRun,
  useCreateProjectChatSession,
  useDeleteProjectChatSession,
  useProjectAgentRun,
  useProjectChatMessages,
  useProjectChatSessions,
  useProjectChatVectorSync,
  useProjectMeetingIngestionBatches,
  useRunProjectAgent,
  useStartProjectMeetingIngestion,
} from "@/hooks/api";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { AgentToolConfirmationList } from "@/components/ai/AgentToolConfirmation";
import type { AgentToolRun } from "@/lib/types";
import { structureAssistantMessage } from "@/lib/projectChatFormatting";

const STARTERS = [
  "Summarize this project as of today",
  "What changed this week?",
  "What needs my attention?",
  "Draft a client update",
];

type ChatClarification = {
  question: string;
  reason?: string;
  importance?: string;
};

type MemoryCitation = {
  id: string;
  title: string;
  section?: string;
  url?: string;
};

function messageMetadata(value: unknown): {
  fileReview: boolean;
  failed: boolean;
  questions: ChatClarification[];
  tasksChecked?: number;
  snapshotSource?: string;
  memoryProvider?: string;
  memoryMatches?: number;
  memorySources: string[];
  memoryCitations: MemoryCitation[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { fileReview: false, failed: false, questions: [], memorySources: [], memoryCitations: [] };
  }
  const metadata = value as Record<string, unknown>;
  const questions = Array.isArray(metadata.clarification_questions)
    ? metadata.clarification_questions.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const row = entry as Record<string, unknown>;
        const question = typeof row.question === "string" ? row.question.trim() : "";
        if (!question) return [];
        return [{
          question,
          reason: typeof row.reason === "string" ? row.reason : undefined,
          importance: typeof row.importance === "string" ? row.importance : undefined,
        }];
      })
    : [];
  return {
    fileReview: metadata.file_review === true,
    failed: metadata.status === "failed",
    questions,
    tasksChecked: typeof metadata.clickup_tasks_checked === "number" ? metadata.clickup_tasks_checked : undefined,
    snapshotSource: typeof metadata.clickup_task_snapshot_source === "string" ? metadata.clickup_task_snapshot_source : undefined,
    memoryProvider: typeof metadata.memory_provider === "string" ? metadata.memory_provider : undefined,
    memoryMatches: typeof metadata.memory_matches === "number" ? metadata.memory_matches : undefined,
    memorySources: Array.isArray(metadata.memory_sources)
      ? metadata.memory_sources.filter((entry): entry is string => typeof entry === "string").slice(0, 4)
      : [],
    memoryCitations: Array.isArray(metadata.memory_citations)
      ? metadata.memory_citations.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const row = entry as Record<string, unknown>;
          const id = typeof row.id === "string" ? row.id : "";
          const title = typeof row.source_title === "string" ? row.source_title : "Untitled source";
          if (!id) return [];
          const rawUrl = typeof row.canonical_url === "string" ? row.canonical_url : "";
          return [{
            id,
            title,
            section: typeof row.section_path === "string" ? row.section_path : undefined,
            url: /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined,
          }];
        }).slice(0, 10)
      : [],
  };
}

function inlineMessageText(value: string): React.ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

type AssistantSection = { title: string; items: string[]; paragraphs: string[] };

function parseAssistantMessage(content: string): {
  title?: string;
  intro: string[];
  introItems: string[];
  sections: AssistantSection[];
} {
  const result: { title?: string; intro: string[]; introItems: string[]; sections: AssistantSection[] } = {
    intro: [],
    introItems: [],
    sections: [],
  };
  let current: AssistantSection | undefined;
  for (const rawLine of structureAssistantMessage(content).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      if (heading[1].length <= 2 && !result.title) result.title = heading[2];
      else {
        current = { title: heading[2], items: [], paragraphs: [] };
        result.sections.push(current);
      }
      continue;
    }
    const item = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/)?.[1];
    if (item) {
      if (current) current.items.push(item);
      else result.introItems.push(item);
    } else if (current) current.paragraphs.push(line);
    else result.intro.push(line);
  }
  return result;
}

function AssistantSectionContent({ section }: { section: AssistantSection }) {
  const key = section.title.toLowerCase();
  const lines = [...section.paragraphs, ...section.items];

  if (key.includes("source freshness") || key === "sources") {
    return (
      <div className="flex items-start gap-1.5 border-t border-border/60 pt-2 text-[11px] leading-4 text-muted-foreground">
        <Clock3 className="mt-0.5 h-3 w-3 shrink-0" />
        <span>{inlineMessageText(lines.join(" "))}</span>
      </div>
    );
  }

  if (key.includes("ready for feedback") || key.includes("completed")) {
    return (
      <section className="flex items-start gap-2.5 rounded-lg bg-success-muted/55 px-3 py-2 text-[13px] leading-5">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <div className="min-w-0">
          <h4 className="font-semibold text-foreground">{inlineMessageText(section.title)}</h4>
          {lines.map((line, index) => <p key={index} className="text-foreground/80">{inlineMessageText(line)}</p>)}
        </div>
      </section>
    );
  }

  if (key.includes("clarification") || key.includes("risk") || key.includes("blocked")) {
    return (
      <section className="flex items-start gap-2.5 rounded-lg bg-warning-muted/55 px-3 py-2 text-[13px] leading-5">
        <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0">
          <h4 className="font-semibold text-foreground">{inlineMessageText(section.title)}</h4>
          {lines.map((line, index) => <p key={index} className="text-foreground/80">{inlineMessageText(line)}</p>)}
        </div>
      </section>
    );
  }

  if (key.includes("next meeting") || key.includes("deliverable")) {
    return (
      <section className="rounded-lg border border-info/20 bg-info-muted/30 px-3 py-2.5">
        <h4 className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-foreground">
          <CalendarDays className="h-3.5 w-3.5 text-info" />
          {inlineMessageText(section.title)}
        </h4>
        <div className="divide-y divide-border/55">
          {lines.map((line, index) => (
            <div key={index} className="flex gap-2.5 py-1.5 text-[13px] leading-5 first:pt-0 last:pb-0">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-info/10 text-[10px] font-semibold text-info">{index + 1}</span>
              <p className="min-w-0 text-foreground/85">{inlineMessageText(line)}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (key.includes("clickup action") || key.includes("action needed") || key.includes("recommended action")) {
    return (
      <section className="rounded-lg border border-info/20 bg-info-muted/25 px-3 py-2.5">
        <h4 className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-foreground">
          <ListChecks className="h-3.5 w-3.5 text-info" />
          {inlineMessageText(section.title)}
        </h4>
        <div className="divide-y divide-border/55">
          {lines.map((line, index) => (
            <div key={index} className="flex gap-2.5 py-1.5 text-[13px] leading-5 first:pt-0 last:pb-0">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
              <p className="min-w-0 text-foreground/85">{inlineMessageText(line)}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (key.includes("what changed") || key.includes("slack") || key.includes("activity")) {
    return (
      <section>
        <h4 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
          <MessagesSquare className="h-3.5 w-3.5 text-info" />
          {inlineMessageText(section.title)}
        </h4>
        <div className="space-y-1.5">
          {lines.map((line, index) => (
            <p key={index} className="border-l-2 border-info/25 py-0.5 pl-2.5 text-[13px] leading-5 text-foreground/85">
              {inlineMessageText(line)}
            </p>
          ))}
        </div>
      </section>
    );
  }

  const isProgress = key.includes("progress") || key.includes("in progress") || key.includes("working on");
  return (
    <section>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {inlineMessageText(section.title)}
      </h4>
      {section.paragraphs.map((line, index) => <p key={`p-${index}`} className="mb-1 text-foreground/85">{inlineMessageText(line)}</p>)}
      {section.items.length > 0 && (
        <div className={cn("grid gap-x-5 gap-y-1", isProgress && section.items.length > 2 ? "sm:grid-cols-2" : "grid-cols-1")}>
          {section.items.map((line, index) => (
            <p key={index} className="border-l-2 border-info/25 py-0.5 pl-2.5 text-[13px] leading-5 text-foreground/85">
              {inlineMessageText(line)}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function ChatMessageContent({ content, failed = false }: { content: string; failed?: boolean }) {
  if (failed) {
    return (
      <div className="flex items-start gap-2.5 text-[13px] leading-5">
        <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div>
          <p className="font-semibold text-foreground">Request couldn’t be completed</p>
          <p className="text-muted-foreground">{content}</p>
        </div>
      </div>
    );
  }
  const message = parseAssistantMessage(content);
  return (
    <div className="space-y-2.5 text-[13.5px] leading-[1.45rem]">
      {message.title && (
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{inlineMessageText(message.title)}</h3>
      )}
      {message.intro.map((line, index) => <p key={`intro-${index}`} className="text-foreground/85">{inlineMessageText(line)}</p>)}
      {message.introItems.length > 0 && (
        <div className="space-y-1">
          {message.introItems.map((line, index) => <p key={index} className="text-foreground/85">{inlineMessageText(line)}</p>)}
        </div>
      )}
      {message.sections.map((section, index) => <AssistantSectionContent key={`${section.title}-${index}`} section={section} />)}
    </div>
  );
}

function withoutDuplicatedClarifications(content: string, hasInteractiveQuestions: boolean): string {
  if (!hasInteractiveQuestions) return content;
  const match = /(?:^|\n)(?:#{1,4}\s*)?questions to clarify\s*:?(?:\n|$)/i.exec(content);
  return match ? content.slice(0, match.index).trim() : content;
}

export function ProjectChat({ projectId, className }: { projectId: string; className?: string }) {
  const { toast } = useToast();
  const { data: chatSessions = [], isLoading: sessionsLoading, refetch: refetchSessions } = useProjectChatSessions(projectId);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const { data: messages = [], isLoading, refetch } = useProjectChatMessages(projectId, activeSessionId);
  const { data: vectorSync, refetch: refetchVectorSync } = useProjectChatVectorSync(projectId);
  const { data: meetingBatches = [], refetch: refetchMeetingBatches } = useProjectMeetingIngestionBatches(projectId);
  const { data: toolRuns = [], refetch: refetchToolRuns } = useAgentToolRuns(projectId);
  const runAgent = useRunProjectAgent();
  const startMeetingIngestion = useStartProjectMeetingIngestion();
  const createChat = useCreateProjectChatSession();
  const deleteChat = useDeleteProjectChatSession();
  const confirmTool = useConfirmAgentToolRun();
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  const [activeRunId, setActiveRunId] = useState<string>();
  const run = useProjectAgentRun(activeRunId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const uploading = startMeetingIngestion.isPending || Object.keys(uploadProgress).length > 0;
  const running = runAgent.isPending || run.data?.status === "pending" || run.data?.status === "running";
  const activeMeetingBatch = meetingBatches.find((batch) => batch.status === "queued" || batch.status === "processing");

  useEffect(() => {
    setActiveSessionId(undefined);
    setActiveRunId(undefined);
    setClarificationAnswers({});
    setUploadProgress({});
  }, [projectId]);

  useEffect(() => {
    if (sessionsLoading) return;
    if (activeSessionId && chatSessions.some((session) => session.id === activeSessionId)) return;
    setActiveSessionId(chatSessions[0]?.id);
  }, [activeSessionId, chatSessions, sessionsLoading]);

  useEffect(() => {
    const viewport = messagesRef.current;
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [messages.length, running]);

  useEffect(() => {
    if (!activeRunId || !run.data) return;
    if (run.data.status === "pending" || run.data.status === "running") return;
    let cancelled = false;
    void (async () => {
      await Promise.all([refetch(), refetchSessions(), refetchToolRuns(), refetchVectorSync()]);
      // Defense in depth for older workers that may publish terminal status a
      // fraction before their chat message transaction is visible.
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      if (cancelled) return;
      await Promise.all([refetch(), refetchToolRuns()]);
      if (!cancelled) setActiveRunId(undefined);
    })();
    return () => { cancelled = true; };
  }, [activeRunId, refetch, refetchSessions, refetchToolRuns, refetchVectorSync, run.data]);

  useEffect(() => {
    const latest = meetingBatches[0];
    if (!latest || latest.status === "queued" || latest.status === "processing") return;
    void Promise.all([refetch(), refetchSessions(), refetchVectorSync()]);
  }, [meetingBatches, refetch, refetchSessions, refetchVectorSync]);

  const startNewChat = async () => {
    if (running || createChat.isPending) return;
    try {
      const session = await createChat.mutateAsync(projectId);
      setActiveSessionId(session.id);
      setInput("");
      setFiles([]);
      setClarificationAnswers({});
      setChatPickerOpen(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      toast({
        title: "Could not create chat",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const removeChat = async (sessionId: string) => {
    if (!sessionId || running || deleteChat.isPending) return;
    const session = chatSessions.find((row) => row.id === sessionId);
    if (!window.confirm(`Delete “${session?.title ?? "this chat"}”? This removes its transcript, but keeps the project's shared memory and documents.`)) return;
    try {
      await deleteChat.mutateAsync({ project_id: projectId, chat_session_id: sessionId });
      if (sessionId === activeSessionId) setActiveSessionId(chatSessions.find((row) => row.id !== sessionId)?.id);
      setClarificationAnswers({});
      toast({ title: "Chat deleted", description: "Project memory and indexed documents were kept." });
    } catch (error) {
      toast({
        title: "Could not delete chat",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const activeSession = chatSessions.find((session) => session.id === activeSessionId);

  const selectMeetingFiles = (selected: File[]) => {
    const combined = [...files, ...selected].filter((file, index, all) =>
      all.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size && candidate.lastModified === file.lastModified) === index
    );
    if (combined.length > 20) {
      toast({ title: "Too many files", description: "You can import up to 20 recordings or transcripts in one batch.", variant: "destructive" });
      return;
    }
    const oversized = combined.find((file) => file.size > 1024 * 1024 * 1024);
    if (oversized) {
      toast({ title: "File is too large", description: `${oversized.name} exceeds the 1 GB per-file limit.`, variant: "destructive" });
      return;
    }
    const totalBytes = combined.reduce((total, file) => total + file.size, 0);
    if (totalBytes > 3 * 1024 * 1024 * 1024) {
      toast({ title: "Batch is too large", description: "Keep the combined upload below 3 GB.", variant: "destructive" });
      return;
    }
    setFiles(combined);
  };

  const send = async (suggestedPrompt?: string, questions?: ChatClarification[]) => {
    const answeredQuestions = (questions ?? []).flatMap((question) => {
      const answer = clarificationAnswers[question.question]?.trim();
      return answer ? [{ question: question.question, answer }] : [];
    });
    const respondingToClarification = answeredQuestions.length > 0;
    const text = respondingToClarification
      ? answeredQuestions.map(({ question, answer }) => `Question: ${question}\nAnswer: ${answer}`).join("\n\n")
      : (suggestedPrompt ?? input).trim();
    if ((!text && files.length === 0) || running || uploading) return;

    try {
      let chatSessionId = activeSessionId;
      if (!chatSessionId) {
        const session = await createChat.mutateAsync(projectId);
        chatSessionId = session.id;
        setActiveSessionId(session.id);
      }
      const reviewingFiles = files.length > 0;
      const message = respondingToClarification
        ? `Clarification responses\n\n${text}`
        : text || `Review the attached ${files.length === 1 ? "meeting file" : "meeting files"} as a project manager. Compare every action item against the current ClickUp board, identify what is already covered, ask specific clarification questions, and prepare confirmation cards for genuinely missing tasks.`;
      if (reviewingFiles) {
        const selectedFiles = [...files];
        const uploadedFileIds = new Array<string>(selectedFiles.length);
        let cursor = 0;
        setUploadProgress(Object.fromEntries(selectedFiles.map((file, index) => [`${index}:${file.name}`, 0])));
        await Promise.all(Array.from({ length: Math.min(3, selectedFiles.length) }, async () => {
          while (cursor < selectedFiles.length) {
            const index = cursor++;
            const file = selectedFiles[index];
            const key = `${index}:${file.name}`;
            uploadedFileIds[index] = await uploadProjectAgentIntakeFile(projectId, file, (percent) => {
              setUploadProgress((current) => ({ ...current, [key]: percent }));
            });
          }
        }));
        const batch = await startMeetingIngestion.mutateAsync({
          project_id: projectId,
          chat_session_id: chatSessionId,
          attachment_ids: uploadedFileIds,
          message,
        });
        setActiveSessionId(batch.chat_session_id);
        setInput("");
        setFiles([]);
        setUploadProgress({});
        if (fileInputRef.current) fileInputRef.current.value = "";
        await Promise.all([refetch(), refetchSessions(), refetchMeetingBatches()]);
        toast({
          title: "Meeting import started",
          description: `${selectedFiles.length} file${selectedFiles.length === 1 ? " is" : "s are"} processing in the background. You can safely leave this page.`,
        });
        return;
      }
      const result = await runAgent.mutateAsync({
        project_id: projectId,
        input_text: message,
        uploaded_file_ids: [],
        mode: reviewingFiles || respondingToClarification ? "auto" : "answer_only",
        chat: true,
        chat_session_id: chatSessionId,
        chat_action: respondingToClarification ? "clarification_response" : undefined,
      });
      setInput("");
      setFiles([]);
      if (respondingToClarification) {
        setClarificationAnswers((current) => {
          const next = { ...current };
          answeredQuestions.forEach(({ question }) => delete next[question]);
          return next;
        });
      }
      setActiveRunId(result.agent_run_id);
      await refetch();
      if (!result.async) setActiveRunId(undefined);
    } catch (error) {
      setUploadProgress({});
      toast({
        title: "Could not send message",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const confirmToolRun = async (toolRun: AgentToolRun, overrides?: Record<string, unknown>) => {
    const retrying = toolRun.status === "failed" || toolRun.status === "running";
    const addingComment = toolRun.tool_name === "add_clickup_comment";
    const actionLabel = addingComment ? "comment" : toolRun.tool_name === "create_clickup_doc" ? "document" : "task";
    try {
      const result = await confirmTool.mutateAsync({
        project_id: projectId,
        tool_run_id: toolRun.id,
        input_payload_overrides: overrides,
      });
      toast({
        title: result?.async
          ? `${addingComment ? "Adding ClickUp comment" : `Creating ClickUp ${actionLabel}`}…`
          : retrying
          ? `${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} retry succeeded`
          : addingComment
          ? "ClickUp comment added"
          : `ClickUp ${actionLabel} created`,
        description: result?.async
          ? "The confirmed action is running in the background."
          : "The confirmed action is now in ClickUp.",
      });
    } catch (error) {
      toast({
        title: retrying ? `${actionLabel} retry failed` : `Could not ${addingComment ? "add comment" : `create ${actionLabel}`}`,
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const cancelToolRun = async (toolRun: AgentToolRun) => {
    try {
      await confirmTool.mutateAsync({ project_id: projectId, tool_run_id: toolRun.id, cancel: true });
      toast({ title: "Suggestion dismissed", description: "Nothing was changed in ClickUp." });
    } catch (error) {
      toast({
        title: "Could not dismiss suggestion",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className={cn("flex min-h-[640px] flex-col overflow-hidden border-border bg-card shadow-none", className)}>
      <CardHeader className="shrink-0 border-b border-border/70 bg-card px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-info-muted p-2 text-info">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-[15px]">Project chat</CardTitle>
              <CardDescription className="mt-0.5 max-w-2xl text-xs">
                Ask about current state or import meeting recordings and transcripts. New context is analyzed against ClickUp in the background.
              </CardDescription>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <span className="hidden items-center gap-1.5 text-xs font-medium text-success xl:inline-flex">
              <span className="h-2 w-2 rounded-full bg-success" />
              {vectorSync?.status === "ready" ? "Pinecone knowledge ready" : "Live context"}
            </span>
            <Popover open={chatPickerOpen} onOpenChange={setChatPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-9 max-w-64 gap-2 rounded-lg border border-border/70 bg-muted/20 px-2.5 hover:bg-muted/50"
                  disabled={running || sessionsLoading}
                  aria-label="Open chat history"
                >
                  <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-info" />
                  <span className="truncate text-xs font-medium">{activeSession?.title ?? "Chats"}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl p-0 shadow-xl">
                <div className="flex items-center justify-between border-b border-border/70 px-3.5 py-3">
                  <div>
                    <p className="text-sm font-semibold">Project chats</p>
                    <p className="text-[11px] text-muted-foreground">Separate conversations, shared project memory</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
                    disabled={running || createChat.isPending}
                    onClick={() => void startNewChat()}
                  >
                    {createChat.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    New
                  </Button>
                </div>
                <div className="max-h-72 overflow-y-auto p-1.5">
                  {chatSessions.length === 0 ? (
                    <div className="px-3 py-8 text-center text-xs text-muted-foreground">No conversations yet.</div>
                  ) : chatSessions.map((session) => {
                    const selected = session.id === activeSessionId;
                    return (
                      <div
                        key={session.id}
                        className={cn(
                          "group flex items-center gap-1 rounded-lg px-1 transition-colors",
                          selected ? "bg-info-muted/70" : "hover:bg-muted/50",
                        )}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 px-2 py-2.5 text-left"
                          onClick={() => {
                            setActiveSessionId(session.id);
                            setClarificationAnswers({});
                            setChatPickerOpen(false);
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{session.title}</span>
                            {selected && <Check className="h-3.5 w-3.5 shrink-0 text-info" />}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {formatDistanceToNow(new Date(session.last_message_at || session.updated_at), { addSuffix: true })}
                          </span>
                        </button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0 text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                          disabled={running || deleteChat.isPending}
                          onClick={() => void removeChat(session.id)}
                          aria-label={`Delete ${session.title}`}
                        >
                          {deleteChat.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div ref={messagesRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-4 p-4 sm:p-5">
            {!isLoading && !sessionsLoading && messages.length === 0 && (
              <div className="mx-auto flex max-w-xl flex-col items-center py-12 text-center">
                <div className="mb-4 rounded-xl bg-info-muted p-3">
                  <Bot className="h-6 w-6 text-info" />
                </div>
                <h3 className="font-semibold">What do you need to know?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  I’ll combine recent project activity with the shared project memory. This chat keeps its own conversation history.
                </p>
              </div>
            )}

            {activeMeetingBatch && (
              <div className="rounded-xl border border-info/25 bg-info-muted/35 p-3.5" role="status" aria-live="polite">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-info/10 p-2 text-info"><AudioLines className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">Processing meeting context</p>
                      <span className="text-xs tabular-nums text-muted-foreground">{activeMeetingBatch.progress_percent}%</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {activeMeetingBatch.completed_count} of {activeMeetingBatch.file_count} files analyzed
                      {activeMeetingBatch.failed_count > 0 ? ` · ${activeMeetingBatch.failed_count} failed` : ""}
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-info/10">
                      <div className="h-full rounded-full bg-info transition-[width] duration-500" style={{ width: `${activeMeetingBatch.progress_percent}%` }} />
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">Safe to leave this page — analysis continues in the background and the summary will appear here.</p>
                  </div>
                </div>
              </div>
            )}

            {messages.map((message) => {
              const fromUser = message.role === "user";
              const metadata = messageMetadata(message.metadata);
              return (
                <div key={message.id} className={cn("flex gap-2.5", fromUser && "flex-row-reverse")}>
                  <div className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    fromUser ? "bg-primary text-primary-foreground" : "bg-info-muted text-info",
                  )}>
                    {fromUser ? <UserRound className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                  </div>
                  <div className="max-w-[88%] min-w-0 space-y-2.5">
                    <div className={cn(
                      "rounded-xl px-3.5 py-3 text-sm leading-6",
                      fromUser
                        ? "rounded-tr-sm bg-primary text-primary-foreground"
                        : "rounded-tl-sm border border-border/70 bg-muted/30 text-foreground",
                    )}>
                      {fromUser ? (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      ) : (
                        <ChatMessageContent
                          content={withoutDuplicatedClarifications(message.content, metadata.questions.length > 0)}
                          failed={metadata.failed}
                        />
                      )}
                    </div>

                    {!fromUser && metadata.memoryMatches != null && metadata.memoryMatches > 0 && (
                      <div className="space-y-1.5 px-1 text-[11px] leading-4 text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          <Database className="h-3 w-3 text-info" />
                          <span className="font-medium text-foreground/75">
                            {metadata.memoryProvider === "pinecone" ? "Pinecone retrieval" : "Supabase fallback"}
                          </span>
                          <span>· {metadata.memoryMatches} relevant passage{metadata.memoryMatches === 1 ? "" : "s"}</span>
                          {metadata.memorySources.length > 0 && (
                            <span className="truncate">· {metadata.memorySources.join(", ")}</span>
                          )}
                        </div>
                        {metadata.memoryCitations.length > 0 && (
                          <div className="flex flex-wrap gap-1.5" aria-label="Answer sources">
                            {metadata.memoryCitations.map((citation) => {
                              const label = `[${citation.id}] ${citation.title}${citation.section ? ` · ${citation.section}` : ""}`;
                              return citation.url ? (
                                <a
                                  key={`${citation.id}-${citation.title}`}
                                  href={citation.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="max-w-full truncate rounded-full border border-border/70 bg-background px-2 py-0.5 text-foreground/80 hover:border-info/50 hover:text-info"
                                  title={label}
                                >
                                  {label}
                                </a>
                              ) : (
                                <span
                                  key={`${citation.id}-${citation.title}`}
                                  className="max-w-full truncate rounded-full border border-border/70 bg-background px-2 py-0.5 text-foreground/70"
                                  title={label}
                                >
                                  {label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {!fromUser && metadata.fileReview && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-l-2 border-info bg-info-muted/55 px-3 py-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Meeting review</span>
                        {metadata.tasksChecked != null && (
                          <span>{metadata.tasksChecked} ClickUp task{metadata.tasksChecked === 1 ? "" : "s"} checked</span>
                        )}
                        {metadata.snapshotSource && (
                          <span>{metadata.snapshotSource} board snapshot</span>
                        )}
                      </div>
                    )}

                    {!fromUser && metadata.questions.length > 0 && (
                      <div className="rounded-lg border border-warning/25 bg-warning-muted/65 p-3">
                        <div className="mb-1 flex items-center gap-2">
                          <CircleHelp className="h-4 w-4 text-warning" />
                          <p className="text-sm font-semibold">Clarifications</p>
                          <span className="text-xs text-muted-foreground">{metadata.questions.length}</span>
                        </div>
                        <div className="divide-y divide-warning/15">
                          {metadata.questions.map((question, index) => (
                            <div key={question.question} className="space-y-2 py-2.5">
                              <p className="text-sm font-medium leading-5">
                                <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>{question.question}
                              </p>
                              <Textarea
                                value={clarificationAnswers[question.question] ?? ""}
                                onChange={(event) => setClarificationAnswers((current) => ({
                                  ...current,
                                  [question.question]: event.target.value,
                                }))}
                                rows={1}
                                className="min-h-9 resize-y bg-background py-2 text-sm"
                                placeholder="Add your answer…"
                                disabled={running}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 flex justify-end border-t border-warning/15 pt-3">
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            disabled={running || !metadata.questions.some((question) => clarificationAnswers[question.question]?.trim())}
                            onClick={() => void send(undefined, metadata.questions)}
                          >
                            Submit answers
                          </Button>
                        </div>
                      </div>
                    )}

                    {!fromUser && message.agent_run_id && (
                      <AgentToolConfirmationList
                        toolRuns={toolRuns}
                        agentRunId={message.agent_run_id}
                        busy={confirmTool.isPending}
                        presentation="chat"
                        onConfirm={confirmToolRun}
                        onCancel={cancelToolRun}
                      />
                    )}
                  </div>
                </div>
              );
            })}

            {running && (
              <div className="flex gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-info-muted text-info">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="flex items-center gap-2 rounded-xl rounded-tl-sm border border-border/70 bg-muted/30 px-3.5 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading the latest project context…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-border/70 bg-background p-3.5 sm:px-5 sm:py-4">
          {!input.trim() && (
            <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => void send(starter)}
                  disabled={running || uploading}
                  className="shrink-0 rounded-full border border-border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-info/30 hover:bg-info-muted hover:text-foreground disabled:opacity-50"
                >
                  {starter}
                </button>
              ))}
            </div>
          )}

          {files.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {files.map((file, index) => {
                const progress = uploadProgress[`${index}:${file.name}`];
                const media = file.type.startsWith("audio/") || file.type.startsWith("video/");
                return (
                <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs">
                  {media ? <AudioLines className="h-3.5 w-3.5 text-info" /> : <FileText className="h-3.5 w-3.5" />}
                  <span className="max-w-52 truncate">{file.name}</span>
                  {progress != null && <span className="tabular-nums text-muted-foreground">{progress}%</span>}
                  <button type="button" disabled={uploading} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`}>
                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                </span>
              )})}
              <span className="self-center text-[11px] text-muted-foreground">{files.length}/20 · processed in background</span>
            </div>
          )}

          <div className="flex items-center gap-2 rounded-xl border border-input bg-card p-2 transition-shadow focus-within:border-info/50 focus-within:ring-2 focus-within:ring-info/10">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".txt,.md,.csv,.json,.vtt,.srt,.mp3,.mp4,.m4a,.wav,.webm,.ogg,.oga,.aac,.flac,.mov,.mpeg,.mpg,text/*,audio/*,video/*"
              onChange={(event) => {
                selectMeetingFiles(Array.from(event.target.files ?? []));
                event.currentTarget.value = "";
              }}
            />
            <Button type="button" size="icon" variant="ghost" className="shrink-0" disabled={uploading} onClick={() => fileInputRef.current?.click()} aria-label="Attach meeting recordings, transcripts, or project files">
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask about this project…"
              className="max-h-36 min-h-10 resize-none border-0 px-1 py-2 leading-5 shadow-none focus-visible:ring-0"
              disabled={running || uploading}
            />
            <Button type="button" size="icon" className="shrink-0 rounded-lg" disabled={running || uploading || (!input.trim() && files.length === 0)} onClick={() => void send()} aria-label="Send message">
              {running || uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Attach up to 20 recordings or transcripts. Large uploads resume automatically; processing continues after you leave.</p>
        </div>
      </CardContent>
    </Card>
  );
}
