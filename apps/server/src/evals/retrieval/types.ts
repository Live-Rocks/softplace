export type RetrievalChunkSensitivity = "ordinary" | "stale" | "sensitive" | "crisis";

export type RetrievalEvalChunk = {
  id: string;
  userId: string;
  content: string;
  sensitivity: RetrievalChunkSensitivity;
};

export type RetrievalEvalSourceMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RetrievalEvalChunkV2 = RetrievalEvalChunk & {
  sourceMessages: [
    RetrievalEvalSourceMessage & { role: "user" },
    RetrievalEvalSourceMessage & { role: "assistant" },
    RetrievalEvalSourceMessage & { role: "user" }
  ];
};

export type RetrievalEvalUser = {
  id: string;
  profile: string;
  chunks: RetrievalEvalChunk[];
};

export type RetrievalEvalLabels = {
  mustRetrieve: string[];
  acceptable: string[];
  forbidden: string[];
};

export type RetrievalEvalCase = {
  id: string;
  userId: string;
  category:
    | "explicit_reference"
    | "implicit_recurrence"
    | "same_entity"
    | "related_optional"
    | "emotion_collision"
    | "entity_collision"
    | "stale_context"
    | "sensitive_or_no_recall";
  query: string;
  recentContext: string[];
  labels: RetrievalEvalLabels;
  rationale: string;
};

export type RetrievalEvalDataset = {
  version: "1.0.0";
  source: "synthetic";
  locale: "zh-TW";
  users: RetrievalEvalUser[];
  cases: RetrievalEvalCase[];
};

export type RetrievalEvalDatasetV2 = {
  version: "2.0.0";
  source: "synthetic";
  locale: "zh-TW";
  users: Array<Omit<RetrievalEvalUser, "chunks"> & { chunks: RetrievalEvalChunkV2[] }>;
  cases: RetrievalEvalCase[];
};

export type QueryStrategy = "query_only" | "with_recent_context";
export type ChunkStrategy = "event_summary" | "user_only" | "dialogue_window";

export type EmbeddingModelSpec = {
  model: string;
  dimensions: number;
};

export type EmbeddingProvider = {
  embed(input: {
    model: string;
    dimensions: number;
    texts: string[];
  }): Promise<number[][]>;
};

export type RetrievalLabel = "must" | "acceptable" | "forbidden" | "irrelevant";

export type RankedRetrieval = {
  chunkId: string;
  content: string;
  score: number;
  label: RetrievalLabel;
};

export type RetrievalCaseResult = {
  caseId: string;
  userId: string;
  query: string;
  queryText: string;
  strategy: QueryStrategy;
  chunkStrategy: ChunkStrategy;
  ranked: RankedRetrieval[];
};

export type RetrievalMetrics = {
  topK: number;
  threshold: number | null;
  evaluatedCases: number;
  mustCases: number;
  noRecallCases: number;
  mustHitRate: number;
  mustRecall: number;
  forbiddenHitRate: number;
  sensitiveCrisisHitRate: number;
  irrelevantHitRate: number;
  abstentionAccuracy: number;
  averageReturned: number;
};

export type RetrievalStrategyReport = {
  strategy: QueryStrategy;
  chunkStrategy: ChunkStrategy;
  corpus: {
    chunks: number;
    averageCharacters: number;
    rawVectorBytes: number;
    serializedVectorBytes: number;
  };
  unthresholded: RetrievalMetrics[];
  thresholdSweep: RetrievalMetrics[];
  candidateThreshold: RetrievalMetrics | null;
  cases: RetrievalCaseResult[];
};

export type RetrievalModelReport = {
  model: string;
  dimensions: number;
  generatedAt: string;
  datasetVersion: string;
  strategies: RetrievalStrategyReport[];
};

export type Phase0Recommendation = {
  model: "text-embedding-3-small";
  dimensions: 512;
  queryStrategy: "with_recent_context";
  chunkStrategy: ChunkStrategy;
  candidateThreshold: RetrievalMetrics;
};
