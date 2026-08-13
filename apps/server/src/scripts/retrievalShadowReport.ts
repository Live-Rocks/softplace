import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseAdmin } from "../integrations/supabase.js";

type Candidate = { run_id: string; rank: number; score: number; review_label: string | null };

export async function main() {
  if (!supabaseAdmin) throw new Error("Supabase configuration is required");
  const [{ data: runs, error: runError }, { data: candidates, error: candidateError }, { data: jobs, error: jobError }] = await Promise.all([
    supabaseAdmin.from("retrieval_shadow_runs").select("id,status,queue_delay_ms,search_latency_ms"),
    supabaseAdmin.from("retrieval_shadow_candidates").select("run_id,rank,score,review_label"),
    supabaseAdmin.from("retrieval_shadow_jobs").select("status")
  ]);
  if (runError || candidateError || jobError) throw new Error("shadow_report_read_failed");
  const runIds = new Set((runs ?? []).map((run) => run.id));
  const grouped = new Map<string, Candidate[]>();
  for (const candidate of (candidates ?? []) as Candidate[]) grouped.set(candidate.run_id, [...(grouped.get(candidate.run_id) ?? []), candidate]);
  const reviewedRunIds = [...runIds].filter((id) => (grouped.get(id)?.length ?? 0) > 0 && grouped.get(id)!.every((candidate) => candidate.review_label));
  const thresholds = [0.45, 0.5, 0.55, 0.6, 0.65, 0.7].map((threshold) => qualityAtThreshold(reviewedRunIds, grouped, threshold));
  const report = {
    generatedAt: new Date().toISOString(),
    privacy: "No chat content is included.",
    jobs: Object.fromEntries(["pending", "processing", "completed", "failed"].map((status) => [status, (jobs ?? []).filter((job) => job.status === status).length])),
    completedRuns: (runs ?? []).filter((run) => run.status === "completed").length,
    errorRuns: (runs ?? []).filter((run) => run.status === "error").length,
    reviewedRuns: reviewedRunIds.length,
    phase1SampleGoal: { completedRuns: 50, reviewedRuns: 25 },
    latencyMs: {
      queueP50: percentile((runs ?? []).map((run) => Number(run.queue_delay_ms)), 0.5),
      queueP95: percentile((runs ?? []).map((run) => Number(run.queue_delay_ms)), 0.95),
      searchP50: percentile((runs ?? []).map((run) => Number(run.search_latency_ms)), 0.5),
      searchP95: percentile((runs ?? []).map((run) => Number(run.search_latency_ms)), 0.95)
    },
    thresholds
  };
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const directory = path.join(repoRoot, "artifacts", "retrieval-shadow", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(directory, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(path.join(directory, "report.md"), markdown(report))
  ]);
  console.info("[retrieval-shadow:report]", { directory, completedRuns: report.completedRuns, reviewedRuns: report.reviewedRuns });
  return { directory, report };
}

export function qualityAtThreshold(runIds: string[], grouped: Map<string, Candidate[]>, threshold: number) {
  const selected = runIds.flatMap((id) => (grouped.get(id) ?? []).filter((candidate) => candidate.rank <= 3 && candidate.score >= threshold));
  const useful = selected.filter((candidate) => candidate.review_label === "must" || candidate.review_label === "acceptable").length;
  const forbidden = selected.filter((candidate) => candidate.review_label === "forbidden").length;
  const usefulRuns = runIds.filter((id) => (grouped.get(id) ?? []).some((candidate) => candidate.rank <= 3 && candidate.score >= threshold && (candidate.review_label === "must" || candidate.review_label === "acceptable"))).length;
  return {
    threshold,
    selectedPrecision: ratio(useful, selected.length),
    queryUsefulHitRate: ratio(usefulRuns, runIds.length),
    forbiddenRate: ratio(forbidden, selected.length),
    selected: selected.length
  };
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(quantile * sorted.length) - 1] ?? 0;
}
function ratio(a: number, b: number) { return b ? a / b : 0; }
function markdown(report: any) {
  const lines = ["# Retrieval Shadow Report", "", `Generated: ${report.generatedAt}`, "", "> No chat content is included.", "", `Completed runs: ${report.completedRuns}`, `Reviewed runs: ${report.reviewedRuns}`, "", "| Threshold | Selected precision | Useful query hit | Forbidden | Selected |", "| ---: | ---: | ---: | ---: | ---: |"];
  for (const row of report.thresholds) lines.push(`| ${row.threshold.toFixed(2)} | ${(row.selectedPrecision * 100).toFixed(1)}% | ${(row.queryUsefulHitRate * 100).toFixed(1)}% | ${(row.forbiddenRate * 100).toFixed(1)}% | ${row.selected} |`);
  return `${lines.join("\n")}\n`;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[retrieval-shadow:report] ${error instanceof Error ? error.message : "failed"}`); process.exitCode = 1; });
}
