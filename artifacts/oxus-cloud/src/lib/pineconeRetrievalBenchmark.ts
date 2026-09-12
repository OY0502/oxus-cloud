export type PineconeBenchmarkCase = {
  id: string;
  category: "answerable" | "temporal_follow_up" | "exact_keyword" | "cross_source" | "unanswerable";
  expectedSourceIds: string[];
  intentionallyUnanswerable?: boolean;
};

export type PineconeBenchmarkHit = {
  sourceId: string;
  rerankScore: number;
};

export type PineconeBenchmarkRun = {
  config: {
    hybridAlpha: number;
    candidateCount: number;
    rerankCount: number;
  };
  observations: Array<{
    caseId: string;
    hits: PineconeBenchmarkHit[];
    latencyMs: number;
  }>;
};

export type PineconeBenchmarkResult = PineconeBenchmarkRun["config"] & {
  minRerankScore: number;
  recallAt10: number;
  meanReciprocalRank: number;
  unanswerableRejectionRate: number;
  p95LatencyMs: number;
};

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

export function evaluatePineconeBenchmark(
  cases: PineconeBenchmarkCase[],
  run: PineconeBenchmarkRun,
  minRerankScore: number,
): PineconeBenchmarkResult {
  const observations = new Map(run.observations.map((observation) => [observation.caseId, observation]));
  const answerable = cases.filter((item) => !item.intentionallyUnanswerable);
  const unanswerable = cases.filter((item) => item.intentionallyUnanswerable);
  let recalled = 0;
  let reciprocalRankTotal = 0;
  let rejected = 0;

  for (const item of cases) {
    const selected = (observations.get(item.id)?.hits ?? [])
      .filter((hit) => hit.rerankScore >= minRerankScore)
      .slice(0, 10);
    if (item.intentionallyUnanswerable) {
      if (selected.length === 0) rejected += 1;
      continue;
    }
    const expected = new Set(item.expectedSourceIds);
    const rank = selected.findIndex((hit) => expected.has(hit.sourceId));
    if (rank >= 0) {
      recalled += 1;
      reciprocalRankTotal += 1 / (rank + 1);
    }
  }

  return {
    ...run.config,
    minRerankScore,
    recallAt10: answerable.length > 0 ? recalled / answerable.length : 1,
    meanReciprocalRank: answerable.length > 0 ? reciprocalRankTotal / answerable.length : 1,
    unanswerableRejectionRate: unanswerable.length > 0 ? rejected / unanswerable.length : 1,
    p95LatencyMs: percentile95(run.observations.map((observation) => observation.latencyMs)),
  };
}

export function selectPineconeBenchmarkConfiguration(
  cases: PineconeBenchmarkCase[],
  runs: PineconeBenchmarkRun[],
  thresholds: number[],
): PineconeBenchmarkResult | null {
  const eligible = runs.flatMap((run) => thresholds.map((threshold) =>
    evaluatePineconeBenchmark(cases, run, threshold)
  )).filter((result) =>
    result.recallAt10 >= 0.9 &&
    result.unanswerableRejectionRate >= 0.9 &&
    result.p95LatencyMs < 5_000
  );

  return eligible.sort((left, right) =>
    right.recallAt10 - left.recallAt10 ||
    right.meanReciprocalRank - left.meanReciprocalRank ||
    right.unanswerableRejectionRate - left.unanswerableRejectionRate ||
    left.p95LatencyMs - right.p95LatencyMs ||
    left.candidateCount - right.candidateCount
  )[0] ?? null;
}
