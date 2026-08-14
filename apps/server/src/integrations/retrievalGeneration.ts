import OpenAI from "openai";
import type { Message } from "@softplace/shared";
import { config } from "../config.js";
import {
  RETRIEVAL_GENERATION,
  buildGenerationQuery,
  generationSearchBeforeSequence,
  prepareGenerationContext,
  retrievalGenerationErrorCode,
  type GenerationCandidate
} from "../domain/retrievalGeneration.js";
import { RETRIEVAL_SHADOW } from "../domain/retrievalShadow.js";
import { supabaseAdmin } from "./supabase.js";

export type GenerationRetrievalResult = {
  status: "injected" | "abstained" | "fallback";
  context: string | null;
  candidates: Array<{ chunkId: string; rank: number; score: number; injected: boolean }>;
  embeddingLatencyMs: number;
  searchLatencyMs: number;
  totalLatencyMs: number;
  retrievalTokens: number;
  errorCode: string | null;
};

export type GenerationRetrievalInput = {
  userId: string;
  conversationId: string;
  history: Message[];
  currentQuery: string;
};

export type GenerationRunRecord = {
  userId: string;
  conversationId: string;
  queryMessageId: string;
  assistantMessageId: string;
  model: string;
  retrieval: GenerationRetrievalResult;
  tokenMetrics: {
    instructionsTokens: number;
    memoryTokens: number;
    history10Tokens: number;
    history20Tokens: number;
    currentQueryTokens: number;
    actualInputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
  };
};

export type GenerationRetriever = (input: GenerationRetrievalInput) => Promise<GenerationRetrievalResult>;
export type GenerationRunRecorder = (input: GenerationRunRecord) => Promise<void>;

export function retrievalGenerationEnabledFor(userId: string) {
  return config.retrievalGenerationEnabled && config.retrievalShadowUserIds.has(userId);
}

export async function retrieveForGeneration(input: GenerationRetrievalInput): Promise<GenerationRetrievalResult> {
  const started = performance.now();
  try {
    return await withTimeout(runRetrieval(input, started), RETRIEVAL_GENERATION.timeoutMs);
  } catch (error) {
    return {
      status: "fallback",
      context: null,
      candidates: [],
      embeddingLatencyMs: 0,
      searchLatencyMs: 0,
      totalLatencyMs: Math.max(0, Math.round(performance.now() - started)),
      retrievalTokens: 0,
      errorCode: retrievalGenerationErrorCode(error)
    };
  }
}

async function runRetrieval(input: GenerationRetrievalInput, started: number): Promise<GenerationRetrievalResult> {
  if (!supabaseAdmin) throw new Error("generation_search_failed");
  const beforeSequence = generationSearchBeforeSequence(input.history);
  if (beforeSequence === null) return emptyResult(started);
  const query = buildGenerationQuery(input.history, input.currentQuery);
  const client = config.openAiApiKey ? new OpenAI({
    apiKey: config.openAiApiKey,
    timeout: RETRIEVAL_GENERATION.timeoutMs,
    maxRetries: 0
  }) : null;
  if (!client) throw new Error("generation_embedding_unconfigured");

  const embeddingStarted = performance.now();
  const response = await client.embeddings.create({
    model: RETRIEVAL_SHADOW.model,
    dimensions: RETRIEVAL_SHADOW.dimensions,
    input: query.text,
    encoding_format: "float"
  });
  const embeddingLatencyMs = Math.max(0, Math.round(performance.now() - embeddingStarted));
  const embedding = response.data[0]?.embedding;
  if (!embedding || embedding.length !== RETRIEVAL_SHADOW.dimensions) throw new Error("generation_embedding_invalid");

  const searchStarted = performance.now();
  const { data, error } = await supabaseAdmin.rpc("match_retrieval_shadow_chunks", {
    p_user_id: input.userId,
    p_conversation_id: input.conversationId,
    p_query_sequence: beforeSequence,
    p_query_embedding: vector(embedding),
    p_limit: RETRIEVAL_GENERATION.candidateLimit
  });
  if (error) throw new Error("generation_search_failed");
  const ranked: Array<{ chunkId: string; score: number; rank: number }> = (data ?? []).map((row: any, index: number) => ({
    chunkId: row.chunk_id as string,
    score: Number(row.score),
    rank: index + 1
  }));
  const candidates = await loadCandidateSources(input, ranked);
  const searchLatencyMs = Math.max(0, Math.round(performance.now() - searchStarted));
  const prepared = prepareGenerationContext(candidates);
  const injected = new Set(prepared?.injectedChunkIds ?? []);
  return {
    status: prepared ? "injected" : "abstained",
    context: prepared?.text ?? null,
    candidates: ranked.map((candidate) => ({ ...candidate, injected: injected.has(candidate.chunkId) })),
    embeddingLatencyMs,
    searchLatencyMs,
    totalLatencyMs: Math.max(0, Math.round(performance.now() - started)),
    retrievalTokens: prepared?.tokenCount ?? 0,
    errorCode: null
  };
}

async function loadCandidateSources(
  input: GenerationRetrievalInput,
  ranked: Array<{ chunkId: string; rank: number; score: number }>
): Promise<GenerationCandidate[]> {
  if (!ranked.length || !supabaseAdmin) return [];
  const { data: chunks, error: chunkError } = await supabaseAdmin.from("retrieval_chunks")
    .select("id,start_sequence,end_sequence")
    .eq("user_id", input.userId)
    .eq("conversation_id", input.conversationId)
    .in("id", ranked.map((candidate) => candidate.chunkId));
  if (chunkError) throw new Error("generation_source_failed");
  const byId = new Map((chunks ?? []).map((chunk: any) => [chunk.id as string, chunk]));
  const ranges = (chunks ?? []).map((chunk: any) =>
    `and(message_sequence.gte.${Number(chunk.start_sequence)},message_sequence.lte.${Number(chunk.end_sequence)})`
  );
  if (!ranges.length) return [];
  const { data: messages, error: messageError } = await supabaseAdmin.from("messages")
    .select("id,message_sequence,role,content,image_present,crisis_detected")
    .eq("conversation_id", input.conversationId)
    .or(ranges.join(","))
    .order("message_sequence", { ascending: true });
  if (messageError) throw new Error("generation_source_failed");
  return ranked.flatMap((candidate) => {
    const chunk = byId.get(candidate.chunkId);
    if (!chunk) return [];
    const startSequence = Number(chunk.start_sequence);
    const endSequence = Number(chunk.end_sequence);
    const sourceRows = (messages ?? [])
      .filter((message: any) => Number(message.message_sequence) >= startSequence && Number(message.message_sequence) <= endSequence);
    if (
      sourceRows.length !== 3 ||
      sourceRows.map((message: any) => message.role).join(",") !== "user,assistant,user" ||
      sourceRows.some((message: any) => message.image_present || message.crisis_detected)
    ) return [];
    return [{
      ...candidate,
      startSequence,
      endSequence,
      source: sourceRows.map((message: any) => ({
          id: message.id,
          sequence: Number(message.message_sequence),
          role: message.role,
          content: message.content
        }))
    }];
  });
}

export async function recordGenerationRun(input: GenerationRunRecord) {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.rpc("record_retrieval_generation_run", {
    p_user_id: input.userId,
    p_conversation_id: input.conversationId,
    p_query_message_id: input.queryMessageId,
    p_assistant_message_id: input.assistantMessageId,
    p_status: input.retrieval.status,
    p_model: input.model,
    p_embedding_latency_ms: input.retrieval.embeddingLatencyMs,
    p_search_latency_ms: input.retrieval.searchLatencyMs,
    p_total_retrieval_latency_ms: input.retrieval.totalLatencyMs,
    p_error_code: input.retrieval.errorCode,
    p_instructions_tokens: input.tokenMetrics.instructionsTokens,
    p_memory_tokens: input.tokenMetrics.memoryTokens,
    p_history_10_tokens: input.tokenMetrics.history10Tokens,
    p_history_20_tokens: input.tokenMetrics.history20Tokens,
    p_retrieval_tokens: input.retrieval.retrievalTokens,
    p_current_query_tokens: input.tokenMetrics.currentQueryTokens,
    p_actual_input_tokens: input.tokenMetrics.actualInputTokens,
    p_cached_input_tokens: input.tokenMetrics.cachedInputTokens,
    p_output_tokens: input.tokenMetrics.outputTokens,
    p_candidates: input.retrieval.candidates,
    p_selection_strategy: RETRIEVAL_GENERATION.selectionStrategy
  });
  if (error) throw new Error("generation_observation_write_failed");
}

export async function cleanupGenerationRuns() {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.rpc("cleanup_retrieval_generation", {
    p_retention_days: RETRIEVAL_GENERATION.retentionDays
  });
  if (error) throw new Error("generation_cleanup_failed");
}

function emptyResult(started: number): GenerationRetrievalResult {
  return {
    status: "abstained",
    context: null,
    candidates: [],
    embeddingLatencyMs: 0,
    searchLatencyMs: 0,
    totalLatencyMs: Math.max(0, Math.round(performance.now() - started)),
    retrievalTokens: 0,
    errorCode: null
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("generation_retrieval_timeout")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function vector(values: number[]) {
  return `[${values.join(",")}]`;
}
