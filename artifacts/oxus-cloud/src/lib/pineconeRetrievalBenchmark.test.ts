import { describe, expect, it } from "vitest";
import {
  evaluatePineconeBenchmark,
  selectPineconeBenchmarkConfiguration,
  type PineconeBenchmarkCase,
  type PineconeBenchmarkRun,
} from "./pineconeRetrievalBenchmark";

const cases: PineconeBenchmarkCase[] = [
  ...Array.from({ length: 10 }, (_, index) => ({
    id: `answerable-${index}`,
    category: (["answerable", "temporal_follow_up", "exact_keyword", "cross_source"] as const)[index % 4],
    expectedSourceIds: [`source-${index}`],
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    id: `unanswerable-${index}`,
    category: "unanswerable" as const,
    expectedSourceIds: [],
    intentionallyUnanswerable: true,
  })),
];

function run(config: PineconeBenchmarkRun["config"], relevantScore: number, noiseScore: number): PineconeBenchmarkRun {
  return {
    config,
    observations: cases.map((item, index) => ({
      caseId: item.id,
      latencyMs: 800 + index,
      hits: item.intentionallyUnanswerable
        ? [{ sourceId: "noise", rerankScore: noiseScore }]
        : [{ sourceId: item.expectedSourceIds[0], rerankScore: relevantScore }],
    })),
  };
}

describe("Pinecone retrieval benchmark", () => {
  it("measures recall, reciprocal rank, no-answer rejection, and p95 latency", () => {
    const result = evaluatePineconeBenchmark(
      cases,
      run({ hybridAlpha: 0.65, candidateCount: 50, rerankCount: 20 }, 0.2, 0.005),
      0.01,
    );
    expect(result).toMatchObject({
      recallAt10: 1,
      meanReciprocalRank: 1,
      unanswerableRejectionRate: 1,
      p95LatencyMs: 818,
    });
  });

  it("selects the highest-quality eligible configuration and rejects unsafe thresholds", () => {
    const selected = selectPineconeBenchmarkConfiguration(cases, [
      run({ hybridAlpha: 0.5, candidateCount: 40, rerankCount: 12 }, 0.008, 0.006),
      run({ hybridAlpha: 0.65, candidateCount: 50, rerankCount: 20 }, 0.2, 0.005),
    ], [0.005, 0.01, 0.25]);
    expect(selected).toMatchObject({
      hybridAlpha: 0.65,
      candidateCount: 50,
      rerankCount: 20,
      minRerankScore: 0.01,
      recallAt10: 1,
      unanswerableRejectionRate: 1,
    });
  });

  it("returns null when no configuration meets the quality and latency gates", () => {
    const slow = run({ hybridAlpha: 0.65, candidateCount: 50, rerankCount: 20 }, 0.2, 0.005);
    slow.observations = slow.observations.map((observation) => ({ ...observation, latencyMs: 5_000 }));
    expect(selectPineconeBenchmarkConfiguration(cases, [slow], [0.01])).toBeNull();
  });
});
