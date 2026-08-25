import type { ProjectTechnicalProfile } from "./technicalProfile";
import type { TaskSpecification } from "./schema";

/** Carrotz Weglot regression fixture — semantic quality benchmark. */
export const CARROTZ_WEGLOT_FIXTURE = {
  projectName: "Carrotz",
  clientName: "Carrotz",
  request: "Implement multilingual support in the existing Carrotz Bubble app using Weglot.",
  technicalProfile: {
    application_type: "Maintenance management application",
    public_or_authenticated: "authenticated",
    platforms: ["Web", "Mobile-oriented"],
    no_code_platform: "Bubble",
    navigation_model: "SPA-style navigation with reusable elements",
    content_rendering_model: "Dynamically rendered Bubble content; rich text (TipTap)",
    authentication_model: "Authenticated field workers and admins",
    planned_integrations: ["Weglot"],
    target_languages: ["English", "Polish"],
    source_language: null,
    SEO_relevance: "none",
    migration_constraints: ["Future migration away from Bubble is a consideration"],
    confirmed_technical_decisions: ["Localization provider: Weglot"],
  } satisfies ProjectTechnicalProfile,
  knownFacts: [
    "Private authenticated maintenance application for field workers and admins",
    "Bubble application with dynamically rendered content",
    "SPA-like navigation and reusable elements",
    "Agreed provider: Weglot",
    "Target languages include English and Polish",
    "Source language must be determined from project evidence",
    "No established public multilingual SEO requirement",
  ],
};

export const SIMPLE_UI_TEXT_FIXTURE = {
  projectName: "Acme Portal",
  clientName: "Acme",
  request: "Change the dashboard welcome message from 'Hello' to 'Welcome back'.",
  expectedComplexity: "simple" as const,
};

export const STRIPE_INTEGRATION_FIXTURE = {
  projectName: "SaaS Billing",
  request: "Integrate Stripe Checkout for subscription billing on the marketing site.",
  namedTechnologies: ["Stripe"],
};

export const DUPLICATE_TASK_FIXTURE = {
  request: "Implement Weglot multilingual support in Carrotz Bubble app",
  proposedTitle: "Integrate Weglot into Carrotz Bubble app",
  existingTasks: [
    { id: "task-1", title: "Integrate Weglot multilingual support into Carrotz Bubble app", status: "pending" },
  ],
  expectDuplicate: true,
};

export function buildMockCarrotzSpec(): TaskSpecification {
  return {
    title: "Integrate Weglot multilingual support into the Carrotz Bubble app",
    task_type: "development",
    objective:
      "Enable authenticated Carrotz users to switch between Norwegian (source), English, and Polish across dynamically rendered Bubble UI without full page reloads.",
    context: [
      "Carrotz is a private authenticated maintenance-management Bubble app for field workers and admins.",
      "OXUS is implementing on behalf of Carrotz; Weglot is the agreed localization provider.",
    ],
    current_state: ["Bubble app is live with Norwegian UI copy; English and Polish are required targets."],
    scope: [
      "Configure Weglot for the authenticated Bubble app domain(s)",
      "Implement language switcher per approved design",
      "Validate dynamic content, SPA navigation, and late-rendered UI strings",
    ],
    out_of_scope: ["Public marketing-site hreflang/SEO", "Machine translation of user-generated work-order numbers"],
    implementation_plan: [
      {
        heading: "Weglot configuration",
        steps: [
          "Confirm source language with client if not already documented",
          "Enable Private/Authenticated mode appropriate for logged-in app",
          "Configure translation exclusions for IDs, codes, and structured values",
        ],
      },
      {
        heading: "Bubble integration",
        steps: [
          "Install Weglot snippet per Bubble SPA guidance",
          "Verify translations on work-order list/detail, maintenance plans, navigation, validation messages",
          "Persist language preference for logged-in users",
        ],
      },
    ],
    technical_notes: [
      "Bubble renders dynamic and late-loaded content — verify toasts and validation after navigation without full reload.",
      "Rich-text fields must retain markup safely when translated.",
      "Confirm Weglot export/migration options before assuming key-value i18n portability.",
    ],
    dependencies: [
      "Client-owned Weglot subscription and billing",
      "Staging domain access for Weglot configuration",
      "Approved language switcher design",
    ],
    deliverables: ["Configured Weglot integration on staging", "QA notes for client validation"],
    acceptance_criteria: [
      "Changing language updates work-order list, detail, maintenance-plan, object/location, navigation, error, and validation text without a full page reload.",
      "Work-order numbers, object IDs, technical codes, and configured structured values remain unchanged in every supported language.",
      "Logged-in users retain their selected language across sessions on the same device/browser.",
    ],
    qa_checks: [
      "Happy path: switch language on primary flows",
      "Navigate between Bubble pages without full reload and confirm late-loaded strings translate",
      "Verify excluded structured values remain untranslated",
      "Confirm language persistence after re-login",
    ],
    assumptions: ["Norwegian is the current source language unless client confirms otherwise"],
    blocking_questions: [],
    risks: ["Weglot plan word-count limits may affect dynamic content volume"],
    suggested_priority: "high",
    suggested_estimate_minutes: 480,
    suggested_status: null,
    suggested_assignee_ids: [],
    source_evidence: [],
    research_sources: [],
    confidence: 0.85,
    quality_warnings: [],
  };
}
