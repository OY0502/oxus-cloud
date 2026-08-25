import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chunkKnowledgeText,
  contextualizeKnowledgeChunk,
} from "../../supabase/functions/_shared/knowledgeChunking";

describe("Pinecone knowledge preparation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("creates bounded section-aware passages with provenance", () => {
    const source = [
      "# Product requirements",
      "Intro context. ".repeat(120),
      "## Authentication",
      "Users sign in with a one-time code. ".repeat(120),
      "## Billing",
      "Invoices are issued monthly. ".repeat(120),
    ].join("\n\n");

    const chunks = chunkKnowledgeText(source, { targetChars: 1_000, overlapChars: 120 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((chunk) => chunk.content.length <= 1_000)).toBe(true);
    expect(chunks.some((chunk) => chunk.sectionPath?.includes("Authentication"))).toBe(true);
    expect(chunks.some((chunk) => chunk.sectionPath?.includes("Billing"))).toBe(true);
    expect(chunks.every((chunk) => chunk.tokenEstimate > 0)).toBe(true);
  });

  it("adds document context to the text embedded and reranked", () => {
    expect(contextualizeKnowledgeChunk({
      title: "Delivery plan",
      sectionPath: "Milestones > Launch",
      sourceType: "clickup_doc",
      content: "Production launch is scheduled after QA sign-off.",
    })).toBe(
      "Document: Delivery plan\nSection: Milestones > Launch\nSource type: clickup_doc\n\n" +
        "Production launch is scheduled after QA sign-off.",
    );
  });

  it("sends one-index hybrid queries with calibrated dense and sparse weights", async () => {
    const env = new Map<string, string>([
      ["PINECONE_API_KEY", "test-key"],
      ["PINECONE_INDEX_HOST", "unit-test.svc.us-east-1.pinecone.io"],
      ["PINECONE_HYBRID_ENABLED", "true"],
      ["PINECONE_HYBRID_ALPHA", "0.65"],
    ]);
    vi.stubGlobal("Deno", { env: { get: (name: string) => env.get(name) } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      matches: [{ id: "source#v1#c0", score: 0.92, metadata: { chunk_text: "Relevant passage" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const { queryPinecone } = await import("../../supabase/functions/_shared/agent/pinecone");
    const result = await queryPinecone({
      projectId: "ABC",
      vector: [1, 2],
      sparseVector: { indices: [3, 8], values: [2, 4] },
      topK: 40,
      filter: { status: { $eq: "active" } },
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.namespace).toBe("project-abc");
    expect(body.vector).toEqual([0.65, 1.3]);
    expect(body.sparseVector).toEqual({ indices: [3, 8], values: [0.7, 1.4] });
    expect(body.filter).toEqual({ status: { $eq: "active" } });
    expect(result[0]).toMatchObject({ id: "source#v1#c0", score: 0.92 });
  });
});
