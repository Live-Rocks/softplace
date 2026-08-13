import type { Phase0Recommendation, RetrievalMetrics, RetrievalModelReport } from "./types.js";

export function renderRetrievalEvalMarkdown(reports: RetrievalModelReport[], recommendation?: Phase0Recommendation | null) {
  const lines = [
    "# SoftPlace Retrieval Eval Baseline",
    "",
    `Generated: ${reports[0]?.generatedAt ?? new Date().toISOString()}`,
    "",
    "> Synthetic offline dataset only. Candidate thresholds are diagnostic suggestions, not production decisions.",
    ""
  ];

  if (recommendation) {
    lines.push(
      "## Phase 0 recommendation",
      "",
      `- Primary model: ${recommendation.model} (${recommendation.dimensions} dimensions)`,
      `- Query strategy: ${recommendation.queryStrategy}`,
      `- Chunk strategy: **${recommendation.chunkStrategy}**`,
      `- Diagnostic threshold: ${recommendation.candidateThreshold.threshold?.toFixed(2) ?? "none"} (not a production decision)`,
      ""
    );
  }

  for (const report of reports) {
    lines.push(`## ${report.model} (${report.dimensions} dimensions)`, "");
    for (const strategy of report.strategies) {
      lines.push(`### ${strategy.chunkStrategy} × ${strategy.strategy}`, "");
      lines.push(
        `Corpus: ${strategy.corpus.chunks} chunks · avg ${strategy.corpus.averageCharacters.toFixed(1)} chars · raw vectors ${bytes(strategy.corpus.rawVectorBytes)} · serialized vectors ${bytes(strategy.corpus.serializedVectorBytes)}`,
        "",
        "#### Unthresholded",
        ""
      );
      lines.push(metricsTable(strategy.unthresholded), "");
      lines.push("#### Candidate threshold", "");
      if (strategy.candidateThreshold) lines.push(metricsTable([strategy.candidateThreshold]), "");
      else lines.push("No candidate threshold was available.", "");
      lines.push("#### Threshold sweep (Top 3)", "");
      lines.push(metricsTable(strategy.thresholdSweep.filter((metric) => metric.topK === 3)), "");
      lines.push("#### Per-case Top 5", "");
      for (const result of strategy.cases) {
        lines.push(`- **${result.caseId}** — ${result.query}`);
        for (const item of result.ranked.slice(0, 5)) {
          lines.push(`  - ${item.chunkId} · ${item.label} · ${item.score.toFixed(4)}`);
        }
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

function metricsTable(metrics: RetrievalMetrics[]) {
  const lines = [
    "| Top K | Threshold | Must hit | Must recall | Forbidden hit | Sensitive/crisis hit | Irrelevant hit | Abstention | Avg returned |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  ];
  for (const metric of metrics) {
    lines.push(
      `| ${metric.topK} | ${metric.threshold === null ? "none" : metric.threshold.toFixed(2)} | ${percent(metric.mustHitRate)} | ${percent(metric.mustRecall)} | ${percent(metric.forbiddenHitRate)} | ${percent(metric.sensitiveCrisisHitRate)} | ${percent(metric.irrelevantHitRate)} | ${percent(metric.abstentionAccuracy)} | ${metric.averageReturned.toFixed(2)} |`
    );
  }
  return lines.join("\n");
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
