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
    confirmed_technical_decisions: mergeArrays(
      base.confirmed_technical_decisions,
      inc.confirmed_technical_decisions,
    ),
    unconfirmed_assumptions: mergeArrays(base.unconfirmed_assumptions, inc.unconfirmed_assumptions),
    source_language: inc.source_language ?? base.source_language ?? null,
    SEO_relevance: inc.SEO_relevance ?? base.SEO_relevance ?? "unknown",
  };
}

/** Infer technical profile hints from PM memory text fields (non-destructive). */
export function inferTechnicalProfileFromMemory(profile: Record<string, unknown> | null | undefined): ProjectTechnicalProfile {
  const hints = emptyTechnicalProfile();
  if (!profile) return hints;

  const blob = JSON.stringify(profile).toLowerCase();
  const notes = [
    ...(Array.isArray(profile.technical_notes) ? profile.technical_notes : []),
    ...(Array.isArray(profile.constraints) ? profile.constraints : []),
    ...(Array.isArray(profile.delivery_notes) ? profile.delivery_notes : []),
  ].join(" ").toLowerCase();

  const combined = `${blob} ${notes}`;

  if (/\bbubble\b/.test(combined)) {
    hints.no_code_platform = "Bubble";
    hints.frontend_stack = hints.frontend_stack ?? "Bubble";
  }
  if (/\bweglot\b/.test(combined)) {
    hints.planned_integrations = [...(hints.planned_integrations ?? []), "Weglot"];
  }
  if (/\bauthenticated\b|\blogin\b|\bprivate app\b|\bfield worker\b/.test(combined)) {
    hints.public_or_authenticated = "authenticated";
    hints.SEO_relevance = hints.SEO_relevance === "unknown" ? "none" : hints.SEO_relevance;
  }
  if (/\benglish\b/.test(combined) && /\bpolish\b/.test(combined)) {
    hints.target_languages = ["English", "Polish"];
  }
  if (/\bnorwegian\b|\bnorsk\b/.test(combined)) {
    hints.source_language = hints.source_language ?? "Norwegian";
  }
  if (/\btiptap\b|\brich text\b|\brich-text\b/.test(combined)) {
    hints.content_rendering_model = "Rich text (TipTap or similar)";
  }
  if (/\bspa\b|\bsingle page\b|\bwithout reload\b/.test(combined)) {
    hints.navigation_model = "SPA-style navigation";
  }
  if (/\bmigrat.*bubble\b|\baway from bubble\b/.test(combined)) {
    hints.migration_constraints = ["Future migration away from Bubble is a consideration"];
  }

  return hints;
}

export function formatTechnicalProfileBlock(profile: ProjectTechnicalProfile | null | undefined): string {
  if (!profile) return "Technical profile: not recorded.";
  const lines: string[] = ["Technical profile (confirmed + inferred — do not invent missing fields):"];
  const entries: [string, unknown][] = [
    ["application_type", profile.application_type],
    ["public_or_authenticated", profile.public_or_authenticated],
    ["platforms", profile.platforms?.join(", ")],
    ["frontend_stack", profile.frontend_stack],
    ["backend_stack", profile.backend_stack],
    ["no_code_platform", profile.no_code_platform],
    ["navigation_model", profile.navigation_model],
    ["content_rendering_model", profile.content_rendering_model],
    ["authentication_model", profile.authentication_model],
    ["current_integrations", profile.current_integrations?.join(", ")],
    ["planned_integrations", profile.planned_integrations?.join(", ")],
    ["source_language", profile.source_language ?? "unknown"],
    ["target_languages", profile.target_languages?.join(", ") || "unknown"],
    ["SEO_relevance", profile.SEO_relevance],
    ["migration_constraints", profile.migration_constraints?.join("; ")],
    ["confirmed_technical_decisions", profile.confirmed_technical_decisions?.join("; ")],
    ["unconfirmed_assumptions", profile.unconfirmed_assumptions?.join("; ")],
  ];
  for (const [key, val] of entries) {
    if (val === null || val === undefined || val === "" || val === "unknown") {
      lines.push(`- ${key}: unknown`);
    } else {
      lines.push(`- ${key}: ${val}`);
    }
  }
  return lines.join("\n");
}

export function languageGuidance(profile: ProjectTechnicalProfile | null | undefined): string {
  if (!profile?.source_language && !(profile?.target_languages?.length)) {
    return "Source and target languages are not fully confirmed in project memory. Distinguish source vs target explicitly; ask at most one blocking question if it materially changes implementation.";
  }
  const source = profile.source_language ?? "unknown";
  const targets = profile.target_languages?.length ? profile.target_languages.join(", ") : "unknown";
  return `Language model: source language = ${source}; target languages = ${targets}. Do NOT treat the source language as a translation target unless explicitly requested.`;
}
