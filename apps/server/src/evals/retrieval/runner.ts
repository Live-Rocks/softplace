import { embedTextsWithCache } from "./embeddings.js";
import {
  buildChunkText,
  buildRetrievalQuery,
  calculateRetrievalMetrics,
  chooseCandidateThreshold,
  rankRetrievalCase
} from "./evaluator.js";
import { assertValidRetrievalEvalDataset } from "./validation.js";
import type {
  ChunkStrategy,
  EmbeddingModelSpec,
  EmbeddingProvider,
  QueryStrategy,
  RetrievalEvalDatasetV2,
  RetrievalModelReport
} from "./types.js";

const strategies: QueryStrategy[] = ["query_only", "with_recent_context"];

export async function runRetrievalModelEval(input: {
  dataset: RetrievalEvalDatasetV2;
  provider: EmbeddingProvider;
  spec: EmbeddingModelSpec;
  cacheDir: string;
  topKs: number[];
  thresholds: number[];
  chunkStrategies?: ChunkStrategy[];
  batchSize?: number;
  ignoreCache?: boolean;
}): Promise<RetrievalModelReport> {
  assertValidRetrievalEvalDataset(input.dataset);
  const chunks = input.dataset.users.flatMap((user) => user.chunks);
  const chunkStrategies = input.chunkStrategies ?? ["event_summary", "user_only", "dialogue_window"];
  const queryTexts = strategies.flatMap((strategy) =>
    input.dataset.cases.map((evalCase) => buildRetrievalQuery(evalCase, strategy))
  );
  const embeddings = await embedTextsWithCache({
    provider: input.provider,
    spec: input.spec,
    texts: [...chunkStrategies.flatMap((strategy) => chunks.map((chunk) => buildChunkText(chunk, strategy))), ...queryTexts],
    cacheDir: input.cacheDir,
    batchSize: input.batchSize,
    ignoreCache: input.ignoreCache
  });
  return {
    model: input.spec.model,
    dimensions: input.spec.dimensions,
    generatedAt: new Date().toISOString(),
    datasetVersion: input.dataset.version,
    strategies: chunkStrategies.flatMap((chunkStrategy) => strategies.map((strategy) => {
      const chunkTexts = chunks.map((chunk) => buildChunkText(chunk, chunkStrategy));
      const chunkEmbeddings = new Map(chunks.map((chunk, index) => {
        const vector = embeddings.get(chunkTexts[index]!);
        if (!vector) throw new Error(`missing_text_embedding:${chunk.id}:${chunkStrategy}`);
        return [chunk.id, vector] as const;
      }));
      const results = input.dataset.cases.map((evalCase) => {
        const queryText = buildRetrievalQuery(evalCase, strategy);
        const queryEmbedding = embeddings.get(queryText);
        if (!queryEmbedding) throw new Error(`missing_query_embedding:${evalCase.id}:${strategy}`);
        return rankRetrievalCase({
          dataset: input.dataset,
          evalCase,
          strategy,
          chunkStrategy,
          chunkEmbeddings,
          queryEmbedding
        });
      });
      const unthresholded = input.topKs.map((topK) =>
        calculateRetrievalMetrics({ dataset: input.dataset, results, topK })
      );
      const thresholdSweep = input.thresholds.flatMap((threshold) =>
        input.topKs.map((topK) =>
          calculateRetrievalMetrics({ dataset: input.dataset, results, topK, threshold })
        )
      );
      return {
        strategy,
        chunkStrategy,
        corpus: {
          chunks: chunks.length,
          averageCharacters: chunkTexts.reduce((sum, text) => sum + text.length, 0) / chunkTexts.length,
          rawVectorBytes: chunks.length * input.spec.dimensions * 4,
          serializedVectorBytes: chunkTexts.reduce((sum, text) => {
            const vector = embeddings.get(text)!;
            return sum + Buffer.byteLength(JSON.stringify(vector), "utf8");
          }, 0)
        },
        unthresholded,
        thresholdSweep,
        candidateThreshold: chooseCandidateThreshold(thresholdSweep),
        cases: results
      };
    }))
  };
}
