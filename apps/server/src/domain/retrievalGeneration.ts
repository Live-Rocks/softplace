import { get_encoding } from "@dqbd/tiktoken";
import type { Message } from "@softplace/shared";
import { RETRIEVAL_SHADOW, isEligibleShadowMessage, truncate } from "./retrievalShadow.js";

export const RETRIEVAL_GENERATION = {
  historyLimit: 10,
  baselineHistoryLimit: 20,
  candidateLimit: 5,
  injectionLimit: 2,
  threshold: 0.6,
  tokenBudget: 1200,
  timeoutMs: 2000,
  retentionDays: 30
} as const;

export type GenerationCandidateSource = Pick<Message, "id" | "sequence" | "role" | "content">;

export type GenerationCandidate = {
  chunkId: string;
  rank: number;
  score: number;
  startSequence: number;
  endSequence: number;
  source: GenerationCandidateSource[];
};

export type PreparedGenerationContext = {
  text: string;
  tokenCount: number;
  injectedChunkIds: string[];
};

const encoder = get_encoding("o200k_base");

export function countTokens(value: string) {
  return encoder.encode(value).length;
}

export function buildGenerationQuery(history: Message[], currentQuery: string) {
  const eligibleUsers = history
    .filter((message) => message.role === "user" && isEligibleShadowMessage(message))
    .slice(-2);
  const recentContext = eligibleUsers.map((message) => truncate(message.content, RETRIEVAL_SHADOW.maxContextCharacters));
  const current = truncate(currentQuery, RETRIEVAL_SHADOW.maxCurrentCharacters);
  return {
    recentContext,
    currentQuery: current,
    text: [...recentContext.map((content) => `最近訊息：${content}`), `目前訊息：${current}`].join("\n")
  };
}

export function generationSearchBeforeSequence(history: Message[]) {
  return history[0]?.sequence ?? null;
}

export function prepareGenerationContext(
  candidates: GenerationCandidate[],
  options: { threshold?: number; injectionLimit?: number; tokenBudget?: number } = {}
): PreparedGenerationContext | null {
  const threshold = options.threshold ?? RETRIEVAL_GENERATION.threshold;
  const injectionLimit = options.injectionLimit ?? RETRIEVAL_GENERATION.injectionLimit;
  const tokenBudget = options.tokenBudget ?? RETRIEVAL_GENERATION.tokenBudget;
  const seenMessages = new Set<string>();
  const selected: Array<{ rank: number; userMessages: string[]; chunkId: string }> = [];

  for (const candidate of [...candidates].sort((left, right) => left.rank - right.rank)) {
    if (candidate.score < threshold || selected.length >= injectionLimit) continue;
    const messages = candidate.source
      .filter((message) => message.role === "user")
      .filter((message) => {
        const key = `${message.id}:${message.sequence}`;
        if (seenMessages.has(key)) return false;
        seenMessages.add(key);
        return true;
      })
      .sort((left, right) => left.sequence - right.sequence);
    if (!messages.length) continue;

    const prepared = { rank: candidate.rank, userMessages: [] as string[], chunkId: candidate.chunkId };
    for (const message of messages) {
      const content = truncate(message.content, RETRIEVAL_SHADOW.maxChunkMessageCharacters);
      const full = [...selected, { ...prepared, userMessages: [...prepared.userMessages, content] }];
      if (countTokens(formatContext(full)) <= tokenBudget) {
        prepared.userMessages.push(content);
        continue;
      }
      const truncated = fitContentToBudget(selected, prepared, content, tokenBudget);
      if (truncated) prepared.userMessages.push(truncated);
      break;
    }
    if (prepared.userMessages.length) selected.push(prepared);
  }

  if (!selected.length) return null;
  const text = formatContext(selected);
  return { text, tokenCount: countTokens(text), injectedChunkIds: selected.map((candidate) => candidate.chunkId) };
}

function fitContentToBudget(
  selected: Array<{ rank: number; userMessages: string[]; chunkId: string }>,
  candidate: { rank: number; userMessages: string[]; chunkId: string },
  content: string,
  budget: number
) {
  const characters = [...content];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const value = characters.slice(0, middle).join("");
    const trial = [...selected, { ...candidate, userMessages: [...candidate.userMessages, value] }];
    if (countTokens(formatContext(trial)) <= budget) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join("");
}

function formatContext(candidates: Array<{ rank: number; userMessages: string[] }>) {
  return JSON.stringify({
    type: "retrieved_user_history",
    warning: "可能相關但不一定適用；本輪與最近對話優先。",
    candidates: candidates.map((candidate) => ({ rank: candidate.rank, user_messages: candidate.userMessages }))
  });
}

export function retrievalGenerationErrorCode(error: unknown) {
  const allowed = new Set([
    "generation_retrieval_timeout",
    "generation_embedding_unconfigured",
    "generation_embedding_invalid",
    "generation_search_failed",
    "generation_source_failed"
  ]);
  const value = error instanceof Error ? error.message : "generation_retrieval_failed";
  return allowed.has(value) ? value : "generation_retrieval_failed";
}
