import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseAdmin } from "../integrations/supabase.js";

type Run = {
  id: string;
  status: "injected" | "abstained" | "fallback";
  selection_strategy: "threshold_top2" | "top5_all";
  injected_count: number;
  embedding_latency_ms: number;
  search_latency_ms: number;
  total_retrieval_latency_ms: number;
  history_10_tokens: number;
  history_20_tokens: number;
  retrieval_tokens: number;
  actual_input_tokens: number | null;
  output_tokens: number | null;
  response_effect: "helpful" | "neutral" | "harmful" | null;
  stale_detected: boolean | null;
  sensitive_detected: boolean | null;
  error_code: string | null;
};

type Candidate = { run_id: string; injected: boolean; review_label: string | null };

export async function main() {
  if (!supabaseAdmin) throw new Error("Supabase configuration is required");
  const [{ data: runRows, error: runError }, { data: candidateRows, error: candidateError }] = await Promise.all([
    supabaseAdmin.from("retrieval_generation_runs").select("id,status,selection_strategy,injected_count,embedding_latency_ms,search_latency_ms,total_retrieval_latency_ms,history_10_tokens,history_20_tokens,retrieval_tokens,actual_input_tokens,output_tokens,response_effect,stale_detected,sensitive_detected,error_code"),
    supabaseAdmin.from("retrieval_generation_candidates").select("run_id,injected,review_label")
  ]);
  if (runError || candidateError) throw new Error("generation_report_read_failed");
  const report = buildGenerationReport((runRows ?? []) as Run[], (candidateRows ?? []) as Candidate[]);
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const directory = path.join(repoRoot, "artifacts", "retrieval-generation", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(directory, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(path.join(directory, "report.md"), markdown(report))
  ]);
  console.info("[retrieval-generation:report]", {
    directory,
    injectedRuns: report.top5AllRuns.injected,
    reviewedInjectedRuns: report.review.reviewedInjectedRuns,
    phase21Pass: report.phase21Pass
  });
  return { directory, report };
}

export function buildGenerationReport(runs: Run[], candidates: Candidate[]) {
  const byRun = new Map<string, Candidate[]>();
  for (const candidate of candidates) byRun.set(candidate.run_id, [...(byRun.get(candidate.run_id) ?? []), candidate]);
  const top5Runs = runs.filter((run) => run.selection_strategy === "top5_all");
  const injectedRuns = top5Runs.filter((run) => run.status === "injected");
  const reviewed = injectedRuns.filter((run) =>
    run.response_effect && (byRun.get(run.id)?.length ?? 0) > 0 && byRun.get(run.id)!.every((candidate) => candidate.review_label)
  );
  const injectedReviewedCandidates = reviewed.flatMap((run) => (byRun.get(run.id) ?? []).filter((candidate) => candidate.injected));
  const usefulInjected = injectedReviewedCandidates.filter((candidate) => candidate.review_label === "must" || candidate.review_label === "acceptable").length;
  const forbiddenInjected = injectedReviewedCandidates.filter((candidate) => candidate.review_label === "forbidden").length;
  const irrelevantInjected = injectedReviewedCandidates.filter((candidate) => candidate.review_label === "irrelevant").length;
  const helpful = reviewed.filter((run) => run.response_effect === "helpful").length;
  const neutral = reviewed.filter((run) => run.response_effect === "neutral").length;
  const harmful = reviewed.filter((run) => run.response_effect === "harmful").length;
  const stale = reviewed.filter((run) => run.stale_detected).length;
  const sensitive = reviewed.filter((run) => run.sensitive_detected).length;
  const contextRatios = injectedRuns
    .filter((run) => run.history_20_tokens > 0)
    .map((run) => (run.history_10_tokens + run.retrieval_tokens) / run.history_20_tokens);
  const tokenSavings = contextRatios.map((ratioValue) => 1 - ratioValue);
  const complete = reviewed.length >= 25;
  const phase21Pass = complete && helpful / reviewed.length >= 0.5 && harmful === 0 && stale === 0 && sensitive === 0 && forbiddenInjected === 0;
  return {
    generatedAt: new Date().toISOString(),
    privacy: "No chat content is included.",
    strategies: {
      thresholdTop2: summarizeStatuses(runs.filter((run) => run.selection_strategy === "threshold_top2")),
      top5All: summarizeStatuses(top5Runs)
    },
    top5AllRuns: summarizeStatuses(top5Runs),
    errors: Object.fromEntries([...new Set(top5Runs.map((run) => run.error_code).filter(Boolean))].map((code) => [code!, top5Runs.filter((run) => run.error_code === code).length])),
    review: {
      targetInjectedRuns: 25,
      reviewedInjectedRuns: reviewed.length,
      helpful,
      neutral,
      harmful,
      stale,
      sensitive,
      helpfulRate: ratio(helpful, reviewed.length),
      injectedCandidatePrecision: ratio(usefulInjected, injectedReviewedCandidates.length),
      injectedForbidden: forbiddenInjected,
      injectedIrrelevant: irrelevantInjected,
      injectedIrrelevantRate: ratio(irrelevantInjected, injectedReviewedCandidates.length),
      averageInjectedChunks: ratio(injectedRuns.reduce((sum, run) => sum + Number(run.injected_count), 0), injectedRuns.length)
    },
    latencyMs: {
      embeddingP50: percentile(top5Runs.map((run) => Number(run.embedding_latency_ms)), 0.5),
      embeddingP95: percentile(top5Runs.map((run) => Number(run.embedding_latency_ms)), 0.95),
      searchP50: percentile(top5Runs.map((run) => Number(run.search_latency_ms)), 0.5),
      searchP95: percentile(top5Runs.map((run) => Number(run.search_latency_ms)), 0.95),
      retrievalP50: percentile(top5Runs.map((run) => Number(run.total_retrieval_latency_ms)), 0.5),
      retrievalP95: percentile(top5Runs.map((run) => Number(run.total_retrieval_latency_ms)), 0.95)
    },
    tokens: {
      history10Median: percentile(top5Runs.map((run) => Number(run.history_10_tokens)), 0.5),
      history20Median: percentile(top5Runs.map((run) => Number(run.history_20_tokens)), 0.5),
      retrievalMedian: percentile(injectedRuns.map((run) => Number(run.retrieval_tokens)), 0.5),
      actualInputMedian: percentile(top5Runs.flatMap((run) => run.actual_input_tokens === null ? [] : [Number(run.actual_input_tokens)]), 0.5),
      outputMedian: percentile(top5Runs.flatMap((run) => run.output_tokens === null ? [] : [Number(run.output_tokens)]), 0.5),
      historyPlusRetrievalVsHistory20Median: percentile(contextRatios, 0.5),
      estimatedSavingsMedian: percentile(tokenSavings, 0.5)
    },
    completionCriteria: {
      reviewedAtLeast25: complete,
      helpfulAtLeast50Percent: reviewed.length > 0 && helpful / reviewed.length >= 0.5,
      zeroHarmfulStaleSensitive: harmful === 0 && stale === 0 && sensitive === 0,
      zeroInjectedForbidden: forbiddenInjected === 0
    },
    phase21Pass
  };
}

function summarizeStatuses(runs: Run[]) {
  return Object.fromEntries(["injected", "abstained", "fallback"].map((status) => [
    status,
    runs.filter((run) => run.status === status).length
  ])) as Record<"injected" | "abstained" | "fallback", number>;
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(quantile * sorted.length) - 1] ?? 0;
}

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

function markdown(report: ReturnType<typeof buildGenerationReport>) {
  return [
    "# Retrieval Generation Canary Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "> No chat content is included.",
    "",
    `Top 5 injected / abstained / fallback: ${report.top5AllRuns.injected} / ${report.top5AllRuns.abstained} / ${report.top5AllRuns.fallback}`,
    `Historical Top 2 injected / abstained / fallback: ${report.strategies.thresholdTop2.injected} / ${report.strategies.thresholdTop2.abstained} / ${report.strategies.thresholdTop2.fallback}`,
    `Reviewed injected runs: ${report.review.reviewedInjectedRuns} / ${report.review.targetInjectedRuns}`,
    `Helpful / Neutral / Harmful: ${report.review.helpful} / ${report.review.neutral} / ${report.review.harmful}`,
    `Stale / Sensitive / Injected forbidden: ${report.review.stale} / ${report.review.sensitive} / ${report.review.injectedForbidden}`,
    `Helpful rate: ${(report.review.helpfulRate * 100).toFixed(1)}%`,
    `Injected candidate precision: ${(report.review.injectedCandidatePrecision * 100).toFixed(1)}%`,
    `Injected irrelevant rate: ${(report.review.injectedIrrelevantRate * 100).toFixed(1)}%`,
    `Average injected chunks: ${report.review.averageInjectedChunks.toFixed(2)}`,
    `Median context token savings vs history 20: ${(report.tokens.estimatedSavingsMedian * 100).toFixed(1)}%`,
    `Retrieval latency P50 / P95: ${report.latencyMs.retrievalP50} / ${report.latencyMs.retrievalP95} ms`,
    "",
    `Phase 2.1 Top 5 pass: ${report.phase21Pass ? "YES" : "NO"}`,
    ""
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[retrieval-generation:report] ${error instanceof Error ? error.message : "failed"}`);
    process.exitCode = 1;
  });
}
