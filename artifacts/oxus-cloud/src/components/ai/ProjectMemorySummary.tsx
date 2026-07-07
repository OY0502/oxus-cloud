import React from "react";

import { Brain } from "lucide-react";

import type { ProjectKnowledgeSource, ProjectPmProfile } from "@/lib/types";

import { latestSourceInfo } from "./projectMemoryUtils";

import { formatDistanceToNow } from "date-fns";



interface Props {

  profile: ProjectPmProfile | null;

  sources: ProjectKnowledgeSource[];

  title?: string;

  actions?: React.ReactNode;

}



export function ProjectMemorySummary({ profile, sources, title, actions }: Props) {

  if (!profile) {

    return (

      <div className="rounded-xl border border-dashed border-periwinkle/40 bg-soft-violet/[0.04] px-4 py-5 text-sm text-cool-slate">

        No project memory yet. Paste notes or upload a transcript to build the PM profile, scope, risks, and proposed tasks.

      </div>

    );

  }



  const latest = latestSourceInfo(profile, sources);



  return (

    <div className="space-y-3">

      <div className="flex flex-wrap items-center justify-between gap-3">

        <div className="flex items-center gap-2">

          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-soft-violet/15 text-soft-violet">

            <Brain className="h-4 w-4" />

          </div>

          <h3 className="text-base font-semibold tracking-tight">

            {title ?? "Project Intelligence"}

          </h3>

        </div>

        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}

      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-cool-slate">

        <span>Updated {formatDistanceToNow(new Date(profile.updated_at), { addSuffix: true })}</span>

        {sources.length > 0 && <span>· {sources.length} source{sources.length !== 1 ? "s" : ""}</span>}

        {latest && (

          <span className="truncate max-w-full sm:max-w-[280px]">· Latest: {latest.label}</span>

        )}

      </div>

    </div>

  );

}

