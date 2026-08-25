/** Versioned task-generation artifacts — bump when behavior changes materially. */
export const TASK_INTENT_PROMPT_VERSION = "1.0.0";
export const TASK_GENERATOR_PROMPT_VERSION = "1.0.0";
export const TASK_REVIEWER_PROMPT_VERSION = "1.0.0";
export const TASK_OUTPUT_SCHEMA_VERSION = "1.0.0";
export const TASK_RENDERER_VERSION = "1.0.0";
export const TASK_RESEARCH_PACKAGE_VERSION = "1.0.0";

export const TASK_GENERATION_VERSIONS = {
  intent_prompt: TASK_INTENT_PROMPT_VERSION,
  generator_prompt: TASK_GENERATOR_PROMPT_VERSION,
  reviewer_prompt: TASK_REVIEWER_PROMPT_VERSION,
  output_schema: TASK_OUTPUT_SCHEMA_VERSION,
  renderer: TASK_RENDERER_VERSION,
  research_package: TASK_RESEARCH_PACKAGE_VERSION,
} as const;
