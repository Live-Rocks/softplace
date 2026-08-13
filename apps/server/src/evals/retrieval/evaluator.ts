import type {
  ChunkStrategy,
  Phase0Recommendation,
  QueryStrategy,
  RankedRetrieval,
  RetrievalCaseResult,
  RetrievalEvalCase,
  RetrievalEvalDatasetV2,
  RetrievalLabel,
  RetrievalMetrics
} from "./types.js";
import { formatSourceMessages } from "./dataset.v2.js";

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) throw new Error("embedding_dimension_mismatch");
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function buildRetrievalQuery(evalCase: RetrievalEvalCase, strategy: QueryStrategy) {
  if (strategy === "query_only" || !evalCase.recentContext.length) return evalCase.query;
  return [...evalCase.recentContext.map((content) => `最近訊息：${content}`), `目前訊息：${evalCase.query}`].join("\n");
}

export function labelForChunk(evalCase: RetrievalEvalCase, chunkId: string): RetrievalLabel {
  if (evalCase.labels.mustRetrieve.includes(chunkId)) return "must";
  if (evalCase.labels.acceptable.includes(chunkId)) return "acceptable";
  if (evalCase.labels.forbidden.includes(chunkId)) return "forbidden";
  return "irrelevant";
}

export function buildChunkText(
  chunk: RetrievalEvalDatasetV2["users"][number]["chunks"][number],
  strategy: ChunkStrategy
) {
  if (strategy === "event_summary") return chunk.content;
  if (strategy === "user_only") {
    return chunk.sourceMessages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
  }
  return formatSourceMessages(chunk.sourceMessages);
}

export function rankRetrievalCase(input: {
  dataset: RetrievalEvalDatasetV2;
  evalCase: RetrievalEvalCase;
  strategy: QueryStrategy;
  chunkStrategy: ChunkStrategy;
  chunkEmbeddings: Map<string, number[]>;
  queryEmbedding: number[];
}) : RetrievalCaseResult {
  const user = input.dataset.users.find((candidate) => candidate.id === input.evalCase.userId);
  if (!user) throw new Error(`unknown_eval_user:${input.evalCase.userId}`);

  const ranked: RankedRetrieval[] = user.chunks
    .map((chunk) => {
      const embedding = input.chunkEmbeddings.get(chunk.id);
      if (!embedding) throw new Error(`missing_chunk_embedding:${chunk.id}`);
      return {
        chunkId: chunk.id,
        content: buildChunkText(chunk, input.chunkStrategy),
        score: cosineSimilarity(input.queryEmbedding, embedding),
        label: labelForChunk(input.evalCase, chunk.id)
      };
    })
    .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId));

  return {
    caseId: input.evalCase.id,
    userId: input.evalCase.userId,
    query: input.evalCase.query,
    queryText: buildRetrievalQuery(input.evalCase, input.strategy),
    strategy: input.strategy,
    chunkStrategy: input.chunkStrategy,
    ranked
  };
}

export function calculateRetrievalMetrics(input: {
  dataset: RetrievalEvalDatasetV2;
  results: RetrievalCaseResult[];
  topK: number;
  threshold?: number | null;
}): RetrievalMetrics {
  const threshold = input.threshold ?? null;
  let mustCases = 0;
  let mustHitCases = 0;
  let totalMust = 0;
  let retrievedMust = 0;
  let forbiddenHitCases = 0;
  let sensitiveCrisisHitCases = 0;
  let irrelevantReturned = 0;
  let totalReturned = 0;
  let noRecallCases = 0;
  let abstainedNoRecallCases = 0;

  const caseMap = new Map(input.dataset.cases.map((evalCase) => [evalCase.id, evalCase]));
  const sensitiveChunkIds = new Set(input.dataset.users.flatMap((user) => user.chunks)
    .filter((chunk) => chunk.sensitivity === "sensitive" || chunk.sensitivity === "crisis")
    .map((chunk) => chunk.id));
  for (const result of input.results) {
    const evalCase = caseMap.get(result.caseId);
    if (!evalCase) throw new Error(`unknown_eval_case:${result.caseId}`);
    const selected = result.ranked
      .filter((item) => threshold === null || item.score >= threshold)
      .slice(0, input.topK);
    const noRecall = !evalCase.labels.mustRetrieve.length && !evalCase.labels.acceptable.length;
    totalReturned += selected.length;
    irrelevantReturned += selected.filter((item) => item.label === "irrelevant").length;
    if (selected.some((item) => item.label === "forbidden")) forbiddenHitCases += 1;
    if (selected.some((item) => sensitiveChunkIds.has(item.chunkId))) sensitiveCrisisHitCases += 1;

    if (evalCase.labels.mustRetrieve.length) {
      mustCases += 1;
      totalMust += evalCase.labels.mustRetrieve.length;
      const hits = selected.filter((item) => item.label === "must").length;
      retrievedMust += hits;
      if (hits > 0) mustHitCases += 1;
    }
    if (noRecall) {
      noRecallCases += 1;
      if (!selected.length) abstainedNoRecallCases += 1;
    }
  }

  const evaluatedCases = input.results.length;
  return {
    topK: input.topK,
    threshold,
    evaluatedCases,
    mustCases,
    noRecallCases,
    mustHitRate: ratio(mustHitCases, mustCases),
    mustRecall: ratio(retrievedMust, totalMust),
    forbiddenHitRate: ratio(forbiddenHitCases, evaluatedCases),
    sensitiveCrisisHitRate: ratio(sensitiveCrisisHitCases, evaluatedCases),
    irrelevantHitRate: ratio(irrelevantReturned, totalReturned),
    abstentionAccuracy: ratio(abstainedNoRecallCases, noRecallCases),
    averageReturned: ratio(totalReturned, evaluatedCases)
  };
}

export function chooseCandidateThreshold(metrics: RetrievalMetrics[]) {
  const topThree = metrics.filter((metric) => metric.topK === 3 && metric.threshold !== null);
  if (!topThree.length) return null;
  return [...topThree].sort((left, right) =>
    left.sensitiveCrisisHitRate - right.sensitiveCrisisHitRate ||
    left.forbiddenHitRate - right.forbiddenHitRate ||
    right.mustRecall - left.mustRecall ||
    right.abstentionAccuracy - left.abstentionAccuracy ||
    left.irrelevantHitRate - right.irrelevantHitRate ||
    (right.threshold ?? 0) - (left.threshold ?? 0)
  )[0] ?? null;
}

export function choosePhase0Recommendation(reports: Array<{
  model: string;
  dimensions: number;
  strategies: Array<{
    strategy: QueryStrategy;
    chunkStrategy: ChunkStrategy;
    candidateThreshold: RetrievalMetrics | null;
  }>;
}>): Phase0Recommendation | null {
  const primary = reports.find((report) => report.model === "text-embedding-3-small" && report.dimensions === 512);
  const candidates = primary?.strategies
    .filter((strategy) => strategy.strategy === "with_recent_context" && strategy.candidateThreshold)
    .map((strategy) => ({ ...strategy, metric: strategy.candidateThreshold! }))
    .filter(({ metric }) => metric.sensitiveCrisisHitRate === 0 && metric.forbiddenHitRate === 0) ?? [];
  const preference: Record<ChunkStrategy, number> = { user_only: 0, event_summary: 1, dialogue_window: 2 };
  const winner = [...candidates].sort((left, right) =>
    right.metric.mustRecall - left.metric.mustRecall ||
    right.metric.abstentionAccuracy - left.metric.abstentionAccuracy ||
    left.metric.irrelevantHitRate - right.metric.irrelevantHitRate ||
    preference[left.chunkStrategy] - preference[right.chunkStrategy]
  )[0];
  if (!winner) return null;
  return {
    model: "text-embedding-3-small",
    dimensions: 512,
    queryStrategy: "with_recent_context",
    chunkStrategy: winner.chunkStrategy,
    candidateThreshold: winner.metric
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}
