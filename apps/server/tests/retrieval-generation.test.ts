import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import type { Message } from "@softplace/shared";
import {
  RETRIEVAL_GENERATION,
  buildGenerationQuery,
  countTokens,
  generationSearchBeforeSequence,
  prepareGenerationContext,
  retrievalGenerationErrorCode,
  type GenerationCandidate
} from "../src/domain/retrievalGeneration.js";
import { buildGenerationReport } from "../src/scripts/retrievalGenerationReport.js";
import { formatGenerationCandidate, formatGenerationReviewHeader, yesNo } from "../src/scripts/retrievalGenerationReview.js";

const history: Message[] = [
  message("u1", 11, "user", "主管昨天又把企劃改掉"),
  message("a1", 12, "assistant", "那種反覆真的很累"),
  message("u2", 13, "user", "我現在看到信就緊張"),
  message("a2", 14, "assistant", "先陪你停一下")
];

test("generation query uses two recent eligible user messages and history cutoff uses the oldest sent message", () => {
  const query = buildGenerationQuery(history, "果然又來了");
  assert.deepEqual(query.recentContext, ["主管昨天又把企劃改掉", "我現在看到信就緊張"]);
  assert.equal(query.text, "最近訊息：主管昨天又把企劃改掉\n最近訊息：我現在看到信就緊張\n目前訊息：果然又來了");
  assert.equal(generationSearchBeforeSequence(history), 11);
  assert.equal(generationSearchBeforeSequence([]), null);
});

test("generation context injects all five candidates regardless of score and never includes assistant text", () => {
  const candidates = [
    candidate("c1", 1, 0.72, [message("old-u1", 1, "user", "第一次被改企劃"), message("old-a1", 2, "assistant", "舊助理推論"), message("old-u2", 3, "user", "那次也很慌")]),
    candidate("c2", 2, 0.66, [message("old-u2", 3, "user", "那次也很慌"), message("old-a2", 4, "assistant", "另一段舊回答"), message("old-u3", 5, "user", "後來同事來幫忙")]),
    candidate("c3", 3, 0.44, [message("u3", 7, "user", "第三段低分候選")]),
    candidate("c4", 4, 0.31, [message("u4", 9, "user", "我幫他取名叫 飽飽")]),
    candidate("c5", 5, 0.20, [message("u5", 11, "user", "第五段也會送出")]),
    candidate("c6", 6, 0.99, [message("u6", 13, "user", "超過 Top 5")])
  ];
  const prepared = prepareGenerationContext(candidates);
  assert.ok(prepared);
  assert.deepEqual(prepared.injectedChunkIds, ["c1", "c2", "c3", "c4", "c5"]);
  assert.match(prepared.text, /第一次被改企劃|那次也很慌|後來同事來幫忙|第三段低分候選|飽飽|第五段也會送出/);
  assert.doesNotMatch(prepared.text, /舊助理推論|另一段舊回答|超過 Top 5/);
  assert.equal((prepared.text.match(/那次也很慌/g) ?? []).length, 1);
});

test("generation context fairly shares the 1200-token budget without dropping later candidates", () => {
  assert.equal(prepareGenerationContext([]), null);
  const prepared = prepareGenerationContext(Array.from({ length: 5 }, (_, index) => candidate(
    `large-${index + 1}`,
    index + 1,
    0.59 - index * 0.05,
    [message(`large-u-${index + 1}`, index + 1, "user", `${index === 4 ? "我幫他取名叫 飽飽。" : ""}繁體中文內容🙂`.repeat(1000))]
  )));
  assert.ok(prepared);
  assert.ok(prepared.tokenCount <= RETRIEVAL_GENERATION.tokenBudget);
  assert.equal(prepared.tokenCount, countTokens(prepared.text));
  assert.deepEqual(prepared.injectedChunkIds, ["large-1", "large-2", "large-3", "large-4", "large-5"]);
  assert.equal((JSON.parse(prepared.text).candidates as Array<{ user_messages: string[] }>).every((item) => item.user_messages[0]?.length), true);
  assert.match(prepared.text, /飽飽/);
  assert.doesNotMatch(prepared.text, /�/);
});

test("generation review formatting identifies injected candidates and validates yes/no answers", () => {
  const header = formatGenerationReviewHeader("run", history, "現在呢", "{context}", "生成回覆");
  assert.match(header, /Recent history \(10 max\)/);
  assert.match(header, /Current query: 現在呢/);
  assert.match(header, /Injected user-only context: \{context\}/);
  assert.match(header, /Generated response: 生成回覆/);
  assert.equal(formatGenerationCandidate({ rank: 2, score: 0.65432, injected: true }), "#2 score=0.6543 injected=yes");
  assert.equal(yesNo("y"), true);
  assert.equal(yesNo("N"), false);
  assert.throws(() => yesNo("maybe"), /invalid yes\/no/);
});

test("generation report requires 25 reviewed injected runs, half helpful, and zero harm", () => {
  const runs = Array.from({ length: 25 }, (_, index) => ({
    id: `run-${index}`,
    status: "injected" as const,
    selection_strategy: "top5_all" as const,
    injected_count: 5,
    embedding_latency_ms: 100,
    search_latency_ms: 50,
    total_retrieval_latency_ms: 150,
    history_10_tokens: 600,
    history_20_tokens: 1200,
    retrieval_tokens: 200,
    actual_input_tokens: 1800,
    output_tokens: 100,
    response_effect: index < 13 ? "helpful" as const : "neutral" as const,
    stale_detected: false,
    sensitive_detected: false,
    error_code: null
  }));
  const candidates = runs.map((run) => ({ run_id: run.id, injected: true, review_label: "must" }));
  const report = buildGenerationReport(runs, candidates);
  assert.equal(report.phase21Pass, true);
  assert.equal(report.review.helpful, 13);
  assert.equal(report.review.averageInjectedChunks, 5);
  assert.equal(report.tokens.estimatedSavingsMedian, 1 - 800 / 1200);
  const harmful = runs.map((run, index) => index === 0 ? { ...run, response_effect: "harmful" as const } : run);
  assert.equal(buildGenerationReport(harmful, candidates).phase21Pass, false);
  const historical = [{ ...runs[0]!, id: "historical", selection_strategy: "threshold_top2" as const, injected_count: 1 }];
  assert.equal(buildGenerationReport([...runs, ...historical], candidates).strategies.thresholdTop2.injected, 1);
  assert.equal(buildGenerationReport([...runs, ...historical], candidates).review.reviewedInjectedRuns, 25);
});

test("generation errors are redacted to fixed codes", () => {
  assert.equal(retrievalGenerationErrorCode(new Error("generation_search_failed")), "generation_search_failed");
  assert.equal(retrievalGenerationErrorCode(new Error("private provider message")), "generation_retrieval_failed");
});

test("generation migration enforces service-role isolation, fixed canary constants, cleanup, and cascades", async () => {
  const sql = await fs.readFile(new URL("../../../supabase/migrations/012_retrieval_generation_canary.sql", import.meta.url), "utf8");
  assert.match(sql, /threshold double precision not null check \(threshold = 0\.60\)/);
  assert.match(sql, /history_limit integer not null check \(history_limit = 10\)/);
  assert.match(sql, /retrieval_token_budget integer not null check \(retrieval_token_budget = 1200\)/);
  assert.match(sql, /references public\.messages\(id\) on delete cascade/g);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /c\.user_id = p_user_id/);
  assert.match(sql, /cleanup_retrieval_generation/);
  assert.match(sql, /p_retention_days integer default 30/);
  assert.match(sql, /revoke all on table public\.retrieval_generation_runs/);
});

test("top five migration preserves the old strategy and records the new strategy separately", async () => {
  const sql = await fs.readFile(new URL("../../../supabase/migrations/013_retrieval_generation_top5.sql", import.meta.url), "utf8");
  assert.match(sql, /selection_strategy text not null default 'threshold_top2'/);
  assert.match(sql, /selection_strategy = 'top5_all'/);
  assert.match(sql, /threshold is null/);
  assert.match(sql, /injection_limit = 5/);
  assert.match(sql, /p_selection_strategy text default 'threshold_top2'/);
  assert.match(sql, /v_injected_count between 0 and 5|injected_count between 0 and 5/);
  assert.match(sql, /revoke all on function public\.record_retrieval_generation_run/);
  assert.match(sql, /to service_role/);
});

test("top five recording, review, and reporting explicitly isolate the new strategy", async () => {
  const [integration, review, report] = await Promise.all([
    fs.readFile(new URL("../src/integrations/retrievalGeneration.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/scripts/retrievalGenerationReview.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/scripts/retrievalGenerationReport.ts", import.meta.url), "utf8")
  ]);
  assert.match(integration, /p_selection_strategy: RETRIEVAL_GENERATION\.selectionStrategy/);
  assert.match(review, /\.eq\("selection_strategy", "top5_all"\)/);
  assert.match(report, /run\.selection_strategy === "top5_all"/);
  assert.match(report, /run\.selection_strategy === "threshold_top2"/);
});

function candidate(chunkId: string, rank: number, score: number, source: Message[]): GenerationCandidate {
  return { chunkId, rank, score, startSequence: source[0]?.sequence ?? 0, endSequence: source.at(-1)?.sequence ?? 0, source };
}

function message(id: string, sequence: number, role: "user" | "assistant", content: string): Message {
  return { id, sequence, role, content, conversationId: "conversation", modelUsed: null, mode: null, imagePresent: false, crisisDetected: false, createdAt: new Date(sequence * 1000).toISOString() };
}
