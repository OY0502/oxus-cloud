import React, { useEffect, useMemo, useState } from "react";

import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { Button } from "@/components/ui/button";

import { CreateClickupTaskDialog } from "@/components/clickup/CreateClickupTaskDialog";

import { useToast } from "@/hooks/use-toast";

import {

  useAiProjectBriefs,

  useAiProposedTasks,

  useClickupMyConnection,

  useCreateClickupTaskFromAiProposal,

  useProjectClickupLink,

  useProjectKnowledgeSources,

  useProjectKnowledgeChunks,

  useProjectPmProfile,

  useStartClickupOAuth,

  useUpdateAiProposedTaskStatus,

} from "@/hooks/api";

import { useClickupOAuthHandler } from "@/hooks/useClickupOAuthHandler";

import {

  clearClickupOAuthReturnIntent,

  consumeClickupOAuthReturnIntent,

  projectClickupOAuthReturnPath,

  saveClickupOAuthReturnIntent,

  stripClickupConnectedSearchParam,

} from "@/lib/clickupOAuthReturn";

import type { AiProposedTask, AiProposedTaskStatus } from "@/lib/types";

import { MemoryIntakePanel } from "./MemoryIntakePanel";

import { NeedsPmAttentionPanel } from "./NeedsPmAttentionPanel";

import { ProjectMemorySummary } from "./ProjectMemorySummary";

import { ProjectMemoryTabs } from "./ProjectMemoryTabs";

import { ProposedTaskCard } from "./ProposedTaskCard";

import {
  ProjectControlCenterAnalyzeButton,
  ProjectControlCenterPanel,
} from "@/components/pm/ProjectControlCenterPanel";



export function ProjectIntelligencePanel({ projectId }: { projectId: string }) {

  const { toast } = useToast();

  const { data: profile = null, isLoading: profileLoading } = useProjectPmProfile(projectId);

  const { data: sources = [] } = useProjectKnowledgeSources(projectId);
  const { data: chunks = [] } = useProjectKnowledgeChunks(projectId);

  const { data: briefs = [], isLoading: briefsLoading, isError: briefsError, error, refetch } = useAiProjectBriefs(projectId);

  const { data: tasks = [] } = useAiProposedTasks(projectId);

  const { data: clickupLink = null } = useProjectClickupLink(projectId);

  const { data: clickupStatus, refetch: refetchClickup } = useClickupMyConnection();

  const startClickupOAuth = useStartClickupOAuth();

  const updateTaskStatus = useUpdateAiProposedTaskStatus();

  const createClickupTaskMutation = useCreateClickupTaskFromAiProposal();

  const { handleError, startConnect } = useClickupOAuthHandler();



  const [intakePrefill, setIntakePrefill] = useState<string | undefined>();

  const [taskFilter, setTaskFilter] = useState<AiProposedTaskStatus | "all">("pending");

  const [createClickupTask, setCreateClickupTask] = useState<AiProposedTask | null>(null);

  const [pendingAiTaskId, setPendingAiTaskId] = useState<string | null>(null);



  useEffect(() => {

    const params = new URLSearchParams(window.location.search);

    const clickupStatusParam = params.get("clickup");



    if (clickupStatusParam === "error") {

      const message = params.get("message");

      stripClickupConnectedSearchParam();

      clearClickupOAuthReturnIntent();

      if (message) {

        toast({

          title: "ClickUp connection failed",

          description: decodeURIComponent(message),

          variant: "destructive",

        });

      }

      return;

    }



    if (clickupStatusParam !== "connected") return;



    stripClickupConnectedSearchParam();

    void refetchClickup();



    const intent = consumeClickupOAuthReturnIntent(projectId);

    if (intent?.kind === "ai_proposed_task") {

      toast({ title: "ClickUp connected", description: "Opening task creation…" });

      setPendingAiTaskId(intent.itemId);

    } else if (intent) {

      saveClickupOAuthReturnIntent(intent);

    }

  }, [projectId, refetchClickup, toast]);



  useEffect(() => {

    if (!pendingAiTaskId || clickupStatus?.connected !== true) return;

    const task = tasks.find((row) => row.id === pendingAiTaskId);

    if (task) {

      setCreateClickupTask(task);

      setPendingAiTaskId(null);

    }

  }, [pendingAiTaskId, clickupStatus?.connected, tasks]);



  const visibleTasks = useMemo(

    () => (taskFilter === "all" ? tasks : tasks.filter((t) => t.status === taskFilter)),

    [tasks, taskFilter],

  );



  const rejectTask = async (task: AiProposedTask) => {

    try {

      await updateTaskStatus.mutateAsync({ id: task.id, project_id: projectId, status: "rejected" });

    } catch (e) {

      toast({ title: "Couldn't update task", description: (e as Error).message, variant: "destructive" });

    }

  };



  const createTaskFromProposal = async (

    task: AiProposedTask,

    options: {
      title: string;
      description?: string;
      priority: AiProposedTask["priority"];
      status?: string;
      assignee_ids: string[];
      due_date?: string;
      time_estimate_minutes?: number;
    },

  ) => {

    try {

      const result = await createClickupTaskMutation.mutateAsync({

        ai_proposed_task_id: task.id,

        project_id: projectId,

        title: options.title,

        description: options.description,

        priority: options.priority,

        status: options.status,

        assignee_ids: options.assignee_ids,

        due_date: options.due_date,

        time_estimate_minutes: options.time_estimate_minutes,

      });

      if ((result as { already_created?: boolean }).already_created) {

        toast({ title: "Already in ClickUp", description: "This proposed task was already synced to ClickUp." });

        return;

      }

      const warnings = (result as { warnings?: string[] }).warnings;

      toast({
        title: "Task created in ClickUp",
        description: warnings?.length ? warnings.join(" ") : `"${options.title}" is in your ClickUp Tasks list.`,
        variant: warnings?.length ? "destructive" : undefined,
      });

    } catch (e) {

      if (!handleError(e, "ClickUp sync failed")) {

        toast({ title: "ClickUp sync failed", description: (e as Error).message, variant: "destructive" });

      }

    }

  };



  const openCreateClickup = async (task: AiProposedTask) => {

    if (clickupStatus?.connected !== true) {

      saveClickupOAuthReturnIntent({ projectId, kind: "ai_proposed_task", itemId: task.id });

      try {

        await startConnect(() =>

          startClickupOAuth.mutateAsync({ redirect_after: projectClickupOAuthReturnPath(projectId) }),

        );

      } catch (e) {

        clearClickupOAuthReturnIntent();

        handleError(e, "Could not start ClickUp connection");

      }

      return;

    }

    setCreateClickupTask(task);

  };



  const tasksBusy = updateTaskStatus.isPending || createClickupTaskMutation.isPending;



  return (

    <div className="space-y-5">

      {profileLoading ? (

        <p className="text-sm text-muted-foreground">Loading project intelligence…</p>

      ) : (

        <>

          <ProjectMemorySummary
            profile={profile}
            sources={sources}
            title="Project Intelligence"
            actions={<ProjectControlCenterAnalyzeButton projectId={projectId} />}
          />



          <MemoryIntakePanel

            projectId={projectId}

            prefillText={intakePrefill}

            onProcessed={() => setIntakePrefill(undefined)}

          />



          <NeedsPmAttentionPanel

            projectId={projectId}

            onUseIntake={(context) => setIntakePrefill(context)}

          />



          <ProjectControlCenterPanel projectId={projectId} embedded />



          {profile && (

            <ProjectMemoryTabs

              projectId={projectId}

              profile={profile}

              sources={sources}

              chunks={chunks}

              briefs={briefs}

              tasks={tasks}

              briefsLoading={briefsLoading}

              briefsError={briefsError}

              onBriefRetry={() => refetch()}

            />

          )}

        </>

      )}



      <section className="space-y-3 pt-4 border-t border-border/80">

        <div className="flex items-center justify-between gap-2 flex-wrap">

          <h3 className="text-sm font-semibold text-foreground">Proposed Tasks</h3>

          <div className="inline-flex items-center rounded-md border border-border bg-muted/50 p-0.5">

            {(["pending", "accepted", "rejected", "all"] as const).map((status) => (

              <Button

                key={status}

                size="sm"

                variant={taskFilter === status ? "secondary" : "ghost"}

                className={`capitalize h-7 text-xs px-3 ${taskFilter === status ? "shadow-sm" : "text-muted-foreground"}`}

                onClick={() => setTaskFilter(status)}

              >

                {status}

              </Button>

            ))}

          </div>

        </div>

        {visibleTasks.length === 0 ? (

          <p className="text-sm text-muted-foreground">No proposed tasks match this filter.</p>

        ) : (

          <div className="space-y-2">

            {visibleTasks.map((task) => (

              <ProposedTaskCard

                key={task.id}

                task={task}

                projectId={projectId}

                teamId={clickupLink?.clickup_team_id}

                onReject={rejectTask}

                onCreateTask={createTaskFromProposal}

                onOpenCreateClickup={openCreateClickup}

                busy={tasksBusy}

              />

            ))}

          </div>

        )}

      </section>



      {briefsError && !profile && (

        <Alert variant="destructive">

          <AlertCircle className="h-4 w-4" />

          <AlertTitle>Could not load data</AlertTitle>

          <AlertDescription>{error?.message}</AlertDescription>

        </Alert>

      )}



      {createClickupTask && (

        <CreateClickupTaskDialog

          open={!!createClickupTask}

          onOpenChange={(open) => {

            if (!open) setCreateClickupTask(null);

          }}

          task={createClickupTask}

          projectId={projectId}

          teamId={clickupLink?.clickup_team_id}

          busy={tasksBusy}

          onConfirm={async (options) => {

            await createTaskFromProposal(createClickupTask, options);

            setCreateClickupTask(null);

          }}

        />

      )}

    </div>

  );

}


