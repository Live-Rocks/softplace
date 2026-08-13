import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import type { Message } from "@softplace/shared";
import { RETRIEVAL_SHADOW, buildShadowDialogueWindow, buildShadowQuery, truncate } from "../src/domain/retrievalShadow.js";
import { processRetrievalShadowJobs, shadowErrorCode, type RetrievalShadowStore } from "../src/integrations/retrievalShadow.js";
import { qualityAtThreshold } from "../src/scripts/retrievalShadowReport.js";

const messages: Message[] = [
  message("u1", 1, "user", "主管昨天又改了企劃"),
  message("a1", 2, "assistant", "那份反覆會讓人很挫折"),
  message("u2", 3, "user", "我今天看到信又緊張了"),
  message("a2", 4, "assistant", "你像是先預期又會被推翻"),
  message("u3", 5, "user", "果然又來了")
];

test("shadow builders preserve Phase 0 roles, recent user context, and deterministic truncation", () => {
  assert.equal(RETRIEVAL_SHADOW.dimensions, 512);
  assert.equal(buildShadowQuery(messages, "u3"), [
    "最近訊息：主管昨天又改了企劃",
    "最近訊息：我今天看到信又緊張了",
    "目前訊息：果然又來了"
  ].join("\n"));
  assert.deepEqual(buildShadowDialogueWindow(messages, "u3"), {
    startSequence: 3,
    endSequence: 5,
    text: "使用者：我今天看到信又緊張了\n安放：你像是先預期又會被推翻\n使用者：果然又來了"
  });
  assert.equal(truncate("甲乙丙", 2), "甲乙");
  assert.equal(buildShadowQuery(messages, "u3"), buildShadowQuery(messages, "u3"));
});

test("shadow builders reject image or crisis query and skip unsafe windows", () => {
  const unsafe = messages.map((item) => item.id === "u3" ? { ...item, crisisDetected: true } : item);
  assert.throws(() => buildShadowQuery(unsafe, "u3"), /shadow_query_ineligible/);
  assert.equal(buildShadowDialogueWindow(unsafe, "u3"), null);
});

test("worker embeds query and window at 512-compatible shape, searches before saving current chunk, and stores no text", async () => {
  const order: string[] = [];
  const completed: any[] = [];
  const store: RetrievalShadowStore = {
    async claimJobs() { return [{ id: "job", userId: "user", conversationId: "conversation", queryMessageId: "u3", attempts: 1, createdAt: "2026-08-13T00:00:00.000Z" }]; },
    async getMessages() { return messages; },
    async match(_job, sequence, embedding) { order.push("match"); assert.equal(sequence, 5); assert.deepEqual(embedding, [1, 0]); return [{ chunkId: "chunk-old", score: 0.7 }]; },
    async upsertChunk(_job, start, end, embedding) { order.push("upsert"); assert.deepEqual([start, end], [3, 5]); assert.deepEqual(embedding, [0, 1]); },
    async complete(_job, _token, queueDelay, latency, candidates) { order.push("complete"); completed.push({ queueDelay, latency, candidates }); },
    async retry() { throw new Error("unexpected retry"); },
    async cleanup() { order.push("cleanup"); }
  };
  let embeddedTexts: string[] = [];
  let clock = Date.parse("2026-08-13T00:00:01.000Z");
  const result = await processRetrievalShadowJobs({
    store,
    provider: { async embed(texts) { embeddedTexts = texts; return [[1, 0], [0, 1]]; } },
    now: () => { const value = clock; clock += 7; return value; }
  });
  assert.deepEqual(result, { claimed: 1, completed: 1, failed: 0 });
  assert.equal(embeddedTexts.length, 2);
  assert.deepEqual(order, ["match", "upsert", "complete", "cleanup"]);
  assert.equal(JSON.stringify(completed).includes("果然又來了"), false);
});

test("worker converts unknown provider errors to a fixed code", async () => {
  let code = "";
  const store: RetrievalShadowStore = {
    async claimJobs() { return [{ id: "job", userId: "user", conversationId: "conversation", queryMessageId: "u3", attempts: 1, createdAt: new Date().toISOString() }]; },
    async getMessages() { return messages; }, async match() { return []; }, async complete() {}, async upsertChunk() {}, async cleanup() {},
    async retry(_id, _token, errorCode) { code = errorCode; }
  };
  await processRetrievalShadowJobs({ store, provider: { async embed() { throw new Error("secret provider payload"); } } });
  assert.equal(code, "shadow_failed");
  assert.equal(shadowErrorCode(new Error("shadow_search_failed")), "shadow_search_failed");
});

test("shadow report recomputes useful and forbidden quality without content", () => {
  const grouped = new Map<string, any[]>([["run", [
    { run_id: "run", rank: 1, score: 0.8, review_label: "must" },
    { run_id: "run", rank: 2, score: 0.7, review_label: "forbidden" },
    { run_id: "run", rank: 3, score: 0.4, review_label: "irrelevant" }
  ]]]);
  assert.deepEqual(qualityAtThreshold(["run"], grouped, 0.6), {
    threshold: 0.6, selectedPrecision: 0.5, queryUsefulHitRate: 1, forbiddenRate: 0.5, selected: 2
  });
});

test("migration enforces pgvector, ownership filtering, leases, retries, RLS, and cascade deletion", async () => {
  const sql = await fs.readFile(new URL("../../../supabase/migrations/011_retrieval_shadow.sql", import.meta.url), "utf8");
  assert.match(sql, /extensions\.vector\(512\)/);
  assert.match(sql, /using hnsw/);
  assert.match(sql, /c\.user_id = p_user_id/);
  assert.match(sql, /c\.end_sequence < p_query_sequence/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /attempts >= 3/);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /references public\.messages\(id\) on delete cascade/);
});

function message(id: string, sequence: number, role: "user" | "assistant", content: string): Message {
  return { id, sequence, role, content, conversationId: "conversation", modelUsed: null, mode: null, imagePresent: false, crisisDetected: false, createdAt: new Date(sequence * 1000).toISOString() };
}
