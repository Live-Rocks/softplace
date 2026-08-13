import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { retrievalEvalDatasetV1 } from "../src/evals/retrieval/dataset.v1.js";
import { retrievalEvalDatasetV2 } from "../src/evals/retrieval/dataset.v2.js";
import {
  createEmbeddingCacheKey,
  createOpenAIEmbeddingProvider,
  embedTextsWithCache
} from "../src/evals/retrieval/embeddings.js";
import {
  buildRetrievalQuery,
  buildChunkText,
  calculateRetrievalMetrics,
  chooseCandidateThreshold,
  choosePhase0Recommendation,
  cosineSimilarity,
  rankRetrievalCase
} from "../src/evals/retrieval/evaluator.js";
import { renderRetrievalEvalMarkdown } from "../src/evals/retrieval/report.js";
import { runRetrievalModelEval } from "../src/evals/retrieval/runner.js";
import { parseArgs } from "../src/evals/retrieval/runRetrievalEval.js";
import { validateRetrievalEvalDataset } from "../src/evals/retrieval/validation.js";
import type { RetrievalCaseResult } from "../src/evals/retrieval/types.js";

test("retrieval dataset contains 8 synthetic users and 40 valid cases", () => {
  assert.deepEqual(validateRetrievalEvalDataset(retrievalEvalDatasetV1), []);
  assert.deepEqual(validateRetrievalEvalDataset(retrievalEvalDatasetV2), []);
  assert.equal(retrievalEvalDatasetV2.users.length, 8);
  assert.equal(retrievalEvalDatasetV2.cases.length, 40);
  assert.equal(retrievalEvalDatasetV2.source, "synthetic");
  assert.equal(
    retrievalEvalDatasetV2.cases.filter((evalCase) =>
      !evalCase.labels.mustRetrieve.length && !evalCase.labels.acceptable.length
    ).length,
    8
  );
});

test("dataset v2 deterministically builds summary, user-only, and dialogue chunks", () => {
  const chunk = retrievalEvalDatasetV2.users[0]!.chunks[0]!;
  assert.deepEqual(chunk.sourceMessages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.equal(buildChunkText(chunk, "event_summary"), chunk.content);
  const userOnly = buildChunkText(chunk, "user_only");
  assert.match(userOnly, /主管在提案前一晚/);
  assert.doesNotMatch(userOnly, /前面的努力像突然/);
  const window = buildChunkText(chunk, "dialogue_window");
  assert.match(window, /使用者：/);
  assert.match(window, /安放：/);
  assert.equal(buildChunkText(chunk, "dialogue_window"), window);
});

test("sensitive and crisis chunks are never positive labels", () => {
  const protectedIds = new Set(
    retrievalEvalDatasetV1.users.flatMap((user) =>
      user.chunks.filter((chunk) => chunk.sensitivity === "sensitive" || chunk.sensitivity === "crisis")
        .map((chunk) => chunk.id)
    )
  );
  for (const evalCase of retrievalEvalDatasetV1.cases) {
    assert.equal(evalCase.labels.forbidden.length > 0, true, evalCase.id);
    for (const id of [...evalCase.labels.mustRetrieve, ...evalCase.labels.acceptable]) {
      assert.equal(protectedIds.has(id), false, `${evalCase.id}:${id}`);
    }
  }
});

test("query strategies preserve the query and add at most two recent messages", () => {
  const evalCase = retrievalEvalDatasetV1.cases.find((candidate) => candidate.id === "case-03")!;
  assert.equal(buildRetrievalQuery(evalCase, "query_only"), evalCase.query);
  assert.match(buildRetrievalQuery(evalCase, "with_recent_context"), /最近訊息：主管剛剛丟了一長串修改/);
  assert.match(buildRetrievalQuery(evalCase, "with_recent_context"), /目前訊息：又是提案前一天/);
});

test("cosine similarity rejects mismatched vectors and ranks only the case user", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.throws(() => cosineSimilarity([1], [1, 0]), /embedding_dimension_mismatch/);

  const evalCase = retrievalEvalDatasetV2.cases[0]!;
  const user = retrievalEvalDatasetV2.users.find((candidate) => candidate.id === evalCase.userId)!;
  const chunkEmbeddings = new Map(user.chunks.map((chunk, index) => [chunk.id, index === 0 ? [1, 0] : [0, 1]]));
  const result = rankRetrievalCase({
    dataset: retrievalEvalDatasetV2,
    evalCase,
    strategy: "query_only",
    chunkStrategy: "event_summary",
    chunkEmbeddings,
    queryEmbedding: [1, 0]
  });
  assert.equal(result.ranked.length, user.chunks.length);
  assert.equal(result.ranked[0]?.chunkId, "synthetic-user-01-chunk-01");
  assert.equal(result.ranked.every((item) => item.chunkId.startsWith("synthetic-user-01-")), true);
});

test("metrics expose must, forbidden, irrelevant, and abstention behavior", () => {
  const dataset = {
    ...retrievalEvalDatasetV2,
    cases: [retrievalEvalDatasetV2.cases[0]!, retrievalEvalDatasetV2.cases[4]!]
  };
  const results: RetrievalCaseResult[] = [
    {
      caseId: "case-01",
      userId: "synthetic-user-01",
      query: "q1",
      queryText: "q1",
      strategy: "query_only",
      chunkStrategy: "event_summary",
      ranked: [
        { chunkId: "synthetic-user-01-chunk-01", content: "must", score: 0.9, label: "must" },
        { chunkId: "synthetic-user-01-chunk-04", content: "forbidden", score: 0.8, label: "forbidden" }
      ]
    },
    {
      caseId: "case-05",
      userId: "synthetic-user-01",
      query: "q2",
      queryText: "q2",
      strategy: "query_only",
      chunkStrategy: "event_summary",
      ranked: [
        { chunkId: "synthetic-user-01-chunk-05", content: "irrelevant", score: 0.4, label: "irrelevant" }
      ]
    }
  ];
  const unthresholded = calculateRetrievalMetrics({ dataset, results, topK: 2 });
  assert.equal(unthresholded.mustHitRate, 1);
  assert.equal(unthresholded.forbiddenHitRate, 0.5);
  assert.equal(unthresholded.sensitiveCrisisHitRate, 0.5);
  assert.equal(unthresholded.irrelevantHitRate, 1 / 3);
  assert.equal(unthresholded.abstentionAccuracy, 0);

  const thresholded = calculateRetrievalMetrics({ dataset, results, topK: 2, threshold: 0.85 });
  assert.equal(thresholded.mustHitRate, 1);
  assert.equal(thresholded.forbiddenHitRate, 0);
  assert.equal(thresholded.abstentionAccuracy, 1);
  assert.equal(chooseCandidateThreshold([{ ...thresholded, topK: 3 }])?.threshold, 0.85);
});

test("embedding cache keys include model, dimensions, and text", () => {
  const first = createEmbeddingCacheKey({ model: "model-a", dimensions: 3 }, "相同文字");
  assert.equal(first, createEmbeddingCacheKey({ model: "model-a", dimensions: 3 }, "相同文字"));
  assert.notEqual(first, createEmbeddingCacheKey({ model: "model-b", dimensions: 3 }, "相同文字"));
  assert.notEqual(first, createEmbeddingCacheKey({ model: "model-a", dimensions: 4 }, "相同文字"));
  assert.notEqual(first, createEmbeddingCacheKey({ model: "model-a", dimensions: 3 }, "不同文字"));
});

test("embedding helper batches missing texts and reuses the disk cache", async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "softplace-retrieval-cache-"));
  const calls: string[][] = [];
  const provider = {
    async embed(input: { texts: string[]; dimensions: number }) {
      calls.push(input.texts);
      return input.texts.map((_text, index) =>
        Array.from({ length: input.dimensions }, (_, dimension) => index + dimension + 1)
      );
    }
  };
  try {
    const spec = { model: "fake-embedding", dimensions: 3 };
    const first = await embedTextsWithCache({ provider, spec, texts: ["甲", "乙", "丙"], cacheDir, batchSize: 2 });
    assert.equal(calls.length, 2);
    assert.deepEqual(first.get("甲"), [1, 2, 3]);
    calls.length = 0;
    const second = await embedTextsWithCache({ provider, spec, texts: ["甲", "乙", "丙"], cacheDir, batchSize: 2 });
    assert.equal(calls.length, 0);
    assert.deepEqual(second.get("丙"), first.get("丙"));
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
});

test("OpenAI embedding adapter restores API index order and rejects incomplete responses", async () => {
  const provider = createOpenAIEmbeddingProvider({
    embeddings: {
      create: async () => ({ data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] }
      ] })
    }
  } as any);
  assert.deepEqual(await provider.embed({ model: "fake", dimensions: 2, texts: ["甲", "乙"] }), [[1, 0], [0, 1]]);

  const incomplete = createOpenAIEmbeddingProvider({
    embeddings: { create: async () => ({ data: [] }) }
  } as any);
  await assert.rejects(incomplete.embed({ model: "fake", dimensions: 2, texts: ["甲"] }), /count_mismatch/);
});

test("CLI parses models, dimension overrides, top K, thresholds, and cache flags", () => {
  const options = parseArgs([
    "--models=text-embedding-3-small",
    "--dimensions=text-embedding-3-small:512",
    "--top-k=1,3",
    "--thresholds=0.6,0.8",
    "--batch-size=16",
    "--ignore-cache"
  ]);
  assert.deepEqual(options.models, [{ model: "text-embedding-3-small", dimensions: 512 }]);
  assert.deepEqual(options.topKs, [1, 3]);
  assert.deepEqual(options.thresholds, [0.6, 0.8]);
  assert.equal(options.batchSize, 16);
  assert.equal(options.ignoreCache, true);
  assert.deepEqual(options.chunkStrategies, ["event_summary", "user_only", "dialogue_window"]);
  const canonical = parseArgs([
    "--specs=text-embedding-3-small:512,text-embedding-3-small:1536",
    "--chunk-strategies=user_only,dialogue_window"
  ]);
  assert.deepEqual(canonical.models, [
    { model: "text-embedding-3-small", dimensions: 512 },
    { model: "text-embedding-3-small", dimensions: 1536 }
  ]);
  assert.deepEqual(canonical.chunkStrategies, ["user_only", "dialogue_window"]);
  assert.throws(() => parseArgs(["--specs=a:2", "--models=a"]), /cannot be combined/);
  assert.throws(() => parseArgs(["--chunk-strategies=unknown"]), /Invalid chunk-strategies/);
  assert.throws(() => parseArgs(["--unknown=value"]), /Unknown option/);
});

test("Phase 0 recommendation is safety-first and uses user-only as the final tie-breaker", () => {
  const metric = {
    topK: 3, threshold: 0.6, evaluatedCases: 40, mustCases: 32, noRecallCases: 8,
    mustHitRate: 0.5, mustRecall: 0.5, forbiddenHitRate: 0, sensitiveCrisisHitRate: 0,
    irrelevantHitRate: 0.1, abstentionAccuracy: 0.875, averageReturned: 0.5
  };
  const recommendation = choosePhase0Recommendation([{
    model: "text-embedding-3-small",
    dimensions: 512,
    strategies: [
      { strategy: "with_recent_context", chunkStrategy: "event_summary", candidateThreshold: metric },
      { strategy: "with_recent_context", chunkStrategy: "user_only", candidateThreshold: metric },
      { strategy: "with_recent_context", chunkStrategy: "dialogue_window", candidateThreshold: { ...metric, mustRecall: 0.9, forbiddenHitRate: 0.025 } }
    ]
  }]);
  assert.equal(recommendation?.chunkStrategy, "user_only");
});

test("full synthetic dataset runs through both strategies and renders a report", async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "softplace-retrieval-e2e-"));
  const provider = {
    async embed(input: { texts: string[]; dimensions: number }) {
      return input.texts.map((text) => {
        const points = [
          [...text].reduce((total, character) => total + character.charCodeAt(0), 0),
          text.length,
          [...text].filter((character) => /[主管老師伴侶房東貓睡家人投稿]/.test(character)).length
        ];
        return points.slice(0, input.dimensions);
      });
    }
  };
  try {
    const report = await runRetrievalModelEval({
      dataset: retrievalEvalDatasetV2,
      provider,
      spec: { model: "fake-embedding", dimensions: 3 },
      cacheDir,
      topKs: [1, 3, 5],
      thresholds: [0.5, 0.8],
      batchSize: 16
    });
    assert.equal(report.strategies.length, 6);
    assert.equal(report.strategies.every((strategy) => strategy.cases.length === 40), true);
    assert.equal(report.strategies.every((strategy) => strategy.unthresholded.length === 3), true);
    assert.match(renderRetrievalEvalMarkdown([report]), /SoftPlace Retrieval Eval Baseline/);
    assert.match(renderRetrievalEvalMarkdown([report]), /Forbidden hit/);
    assert.match(renderRetrievalEvalMarkdown([report]), /Sensitive\/crisis hit/);
    assert.match(renderRetrievalEvalMarkdown([report]), /case-40/);
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
});
