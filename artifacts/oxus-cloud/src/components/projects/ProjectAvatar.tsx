import React, { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { getProjectImageUrl, projectImagePlaceholder } from "@/lib/projectImage";
import type { ProjectWithAssignees } from "@/lib/types";

export type ProjectAvatarSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASS: Record<ProjectAvatarSize, string> = {
  xs: "h-7 w-7 rounded-md text-[10px]",
  sm: "h-9 w-9 rounded-lg text-xs",
  md: "h-14 w-14 rounded-xl text-sm",
  lg: "h-16 w-16 rounded-2xl text-base",
};

function projectInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "P";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function resolveClientLogo(project: ProjectWithAssignees): string | null {
  return project.client_logo_url ?? null;
}

interface ProjectAvatarProps {
  project: Pick<
    ProjectWithAssignees,
    "name" | "image_path" | "company_logo_url" | "company_enriched_name" | "client_logo_url"
  >;
  size?: ProjectAvatarSize;
  className?: string;
}

/**
 * Canonical project avatar: uploaded image → enriched company logo → client logo → initials.
 */
export function ProjectAvatar({ project, size = "sm", className }: ProjectAvatarProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const alt = `${project.company_enriched_name ?? project.name} logo`;
  const initials = projectInitials(project.name);

  useEffect(() => {
    let cancelled = false;
    setErrored(false);
    setLoading(true);

    async function load() {
      if (project.image_path) {
        const signed = await getProjectImageUrl(project.image_path);
        if (cancelled) return;
        if (signed) {
          setUrl(signed);
          setLoading(false);
          return;
        }
      }

      if (project.company_logo_url) {
        setUrl(project.company_logo_url);
        setLoading(false);
        return;
      }

      const clientLogo = resolveClientLogo(project as ProjectWithAssignees);
      if (clientLogo) {
        setUrl(clientLogo);
        setLoading(false);
        return;
      }

      setUrl(null);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [project.image_path, project.company_logo_url, project.client_logo_url]);

  const sizeClasses = SIZE_CLASS[size];

  if (loading) {
    return (
      <div
        className={cn("animate-pulse bg-muted border border-border/60 shrink-0", sizeClasses, className)}
        aria-hidden
      />
    );
  }

  if (url && !errored) {
    return (
      <img
        src={url}
        alt={alt}
        className={cn(
          "object-cover border border-border/60 bg-white shrink-0",
          project.company_logo_url && !project.image_path ? "object-contain p-0.5" : "object-cover",
          sizeClasses,
          className,
        )}
        onError={() => {
          setErrored(true);
          setUrl(null);
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center font-semibold text-muted-foreground bg-muted border border-border/60 shrink-0",
        sizeClasses,
        className,
      )}
      aria-label={alt}
      role="img"
    >
      {initials}
    </div>
  );
}

/** @deprecated Use ProjectAvatar — kept for legacy image-path-only callers. */
export function projectAvatarFallbackUrl(name: string): string {
  return projectImagePlaceholder(name);
}
