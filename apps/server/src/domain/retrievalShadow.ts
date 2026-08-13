import type { Message } from "@softplace/shared";

export const RETRIEVAL_SHADOW = {
  model: "text-embedding-3-small",
  dimensions: 512,
  chunkStrategy: "dialogue_window",
  queryStrategy: "with_recent_context",
  threshold: 0.6,
  topK: 3,
  candidateLimit: 5,
  retentionDays: 90,
  maxCurrentCharacters: 4000,
  maxContextCharacters: 1000,
  maxChunkMessageCharacters: 1800
} as const;

export function isEligibleShadowMessage(message: Message) {
  return !message.imagePresent && !message.crisisDetected && Boolean(message.content.trim());
}

export function buildShadowQuery(messages: Message[], queryMessageId: string) {
  const query = messages.find((message) => message.id === queryMessageId && message.role === "user");
  if (!query || !isEligibleShadowMessage(query)) throw new Error("shadow_query_ineligible");
  const recent = messages
    .filter((message) => message.role === "user" && message.sequence < query.sequence && isEligibleShadowMessage(message))
    .sort((left, right) => right.sequence - left.sequence)
    .slice(0, 2)
    .reverse();
  return [
    ...recent.map((message) => `最近訊息：${truncate(message.content, RETRIEVAL_SHADOW.maxContextCharacters)}`),
    `目前訊息：${truncate(query.content, RETRIEVAL_SHADOW.maxCurrentCharacters)}`
  ].join("\n");
}

export function buildShadowDialogueWindow(messages: Message[], anchorMessageId: string) {
  const anchor = messages.find((message) => message.id === anchorMessageId && message.role === "user");
  if (!anchor || !isEligibleShadowMessage(anchor)) return null;
  const first = messages.find((message) => message.sequence === anchor.sequence - 2 && message.role === "user");
  const assistant = messages.find((message) => message.sequence === anchor.sequence - 1 && message.role === "assistant");
  if (!first || !assistant || !isEligibleShadowMessage(first) || !isEligibleShadowMessage(assistant)) return null;
  return {
    startSequence: first.sequence,
    endSequence: anchor.sequence,
    text: [
      `使用者：${truncate(first.content, RETRIEVAL_SHADOW.maxChunkMessageCharacters)}`,
      `安放：${truncate(assistant.content, RETRIEVAL_SHADOW.maxChunkMessageCharacters)}`,
      `使用者：${truncate(anchor.content, RETRIEVAL_SHADOW.maxChunkMessageCharacters)}`
    ].join("\n")
  };
}

export function truncate(value: string, maxCharacters: number) {
  return [...value].slice(0, maxCharacters).join("");
}

