export type ProjectTechnicalProfile = {
  application_type?: string | null;
  public_or_authenticated?: "public" | "authenticated" | "mixed" | "unknown" | null;
  platforms?: string[];
  frontend_stack?: string | null;
  backend_stack?: string | null;
  no_code_platform?: string | null;
  navigation_model?: string | null;
  content_rendering_model?: string | null;
  authentication_model?: string | null;
  current_integrations?: string[];
  planned_integrations?: string[];
  deployment_environments?: string[];
  target_languages?: string[];
  source_language?: string | null;
  design_system?: string | null;
  known_plugins?: string[];
  data_model_notes?: string[];
  migration_constraints?: string[];
  privacy_constraints?: string[];
  SEO_relevance?: "none" | "low" | "medium" | "high" | "unknown" | null;
  mobile_context?: string | null;
  confirmed_technical_decisions?: string[];
  unconfirmed_assumptions?: string[];
};

export function emptyTechnicalProfile(): ProjectTechnicalProfile {
  return {
    platforms: [],
    current_integrations: [],
    planned_integrations: [],
    deployment_environments: [],
    target_languages: [],
    known_plugins: [],
    data_model_notes: [],
    migration_constraints: [],
    privacy_constraints: [],
    confirmed_technical_decisions: [],
    unconfirmed_assumptions: [],
  };
}

export function mergeTechnicalProfile(
  existing: ProjectTechnicalProfile | null | undefined,
  incoming: ProjectTechnicalProfile | null | undefined,
): ProjectTechnicalProfile {
  const base = { ...emptyTechnicalProfile(), ...(existing ?? {}) };
  const inc = incoming ?? {};
  const mergeArrays = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b].filter(Boolean))];
  return {
    ...base,
    ...inc,
    platforms: mergeArrays(base.platforms, inc.platforms),
    current_integrations: mergeArrays(base.current_integrations, inc.current_integrations),
    planned_integrations: mergeArrays(base.planned_integrations, inc.planned_integrations),
    deployment_environments: mergeArrays(base.deployment_environments, inc.deployment_environments),
    target_languages: mergeArrays(base.target_languages, inc.target_languages),
    known_plugins: mergeArrays(base.known_plugins, inc.known_plugins),
    data_model_notes: mergeArrays(base.data_model_notes, inc.data_model_notes),
    migration_constraints: mergeArrays(base.migration_constraints, inc.migration_constraints),
    privacy_constraints: mergeArrays(base.privacy_constraints, inc.privacy_constraints),
    confirmed_technical_decisions: mergeArrays(base.confirmed_technical_decisions, inc.confirmed_technical_decisions),
    unconfirmed_assumptions: mergeArrays(base.unconfirmed_assumptions, inc.unconfirmed_assumptions),
    source_language: inc.source_language ?? base.source_language ?? null,
    SEO_relevance: inc.SEO_relevance ?? base.SEO_relevance ?? "unknown",
  };
}

export function inferTechnicalProfileFromMemory(profile: Record<string, unknown> | null | undefined): ProjectTechnicalProfile {
  const hints = emptyTechnicalProfile();
  if (!profile) return hints;
  const combined = JSON.stringify(profile).toLowerCase();
  if (/\bbubble\b/.test(combined)) {
    hints.no_code_platform = "Bubble";
    hints.frontend_stack = hints.frontend_stack ?? "Bubble";
  }
  if (/\bweglot\b/.test(combined)) hints.planned_integrations = [...(hints.planned_integrations ?? []), "Weglot"];
  if (/\bauthenticated\b|\blogin\b|\bfield worker\b/.test(combined)) {
    hints.public_or_authenticated = "authenticated";
    hints.SEO_relevance = hints.SEO_relevance === "unknown" ? "none" : hints.SEO_relevance;
  }
  if (/\benglish\b/.test(combined) && /\bpolish\b/.test(combined)) hints.target_languages = ["English", "Polish"];
  if (/\bnorwegian\b|\bnorsk\b/.test(combined)) hints.source_language = hints.source_language ?? "Norwegian";
  if (/\btiptap\b|\brich text\b/.test(combined)) hints.content_rendering_model = "Rich text (TipTap or similar)";
  if (/\bspa\b|\bwithout reload\b/.test(combined)) hints.navigation_model = "SPA-style navigation";
  if (/\bmigrat.*bubble\b/.test(combined)) {
    hints.migration_constraints = ["Future migration away from Bubble is a consideration"];
  }
  return hints;
}

export function formatTechnicalProfileBlock(profile: ProjectTechnicalProfile | null | undefined): string {
  if (!profile) return "Technical profile: not recorded.";
  const lines: string[] = ["Technical profile (do not invent missing fields):"];
  for (const [key, val] of Object.entries(profile)) {
    if (Array.isArray(val)) lines.push(`- ${key}: ${val.length ? val.join(", ") : "unknown"}`);
    else lines.push(`- ${key}: ${val ?? "unknown"}`);
  }
  return lines.join("\n");
}

export function languageGuidance(profile: ProjectTechnicalProfile | null | undefined): string {
  if (!profile?.source_language && !(profile?.target_languages?.length)) {
    return "Source/target languages not fully confirmed. Distinguish explicitly; max one blocking question if material.";
  }
  return `Source language = ${profile.source_language ?? "unknown"}; targets = ${profile.target_languages?.join(", ") || "unknown"}. Do NOT treat source as a translation target.`;
}
