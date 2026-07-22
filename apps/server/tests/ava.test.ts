import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAvaInstructions,
  calculateReplyDueAt,
  extractSafeAvaMemory,
  relationshipStage,
  shouldScheduleProactive
} from "../src/domain/ava.js";

test("available recent conversations schedule replies between 20 and 90 seconds", () => {
  const now = new Date("2026-07-22T04:00:00.000Z");
  const due = calculateReplyDueAt({ availability: "available", lastAssistantAt: now.toISOString(), now, random: () => 0.5 });
  const seconds = (new Date(due).getTime() - now.getTime()) / 1000;
  assert.ok(seconds >= 20 && seconds <= 90);
});

test("busy replies are delayed between 15 and 60 minutes", () => {
  const now = new Date("2026-07-22T04:00:00.000Z");
  const due = calculateReplyDueAt({ availability: "busy", now, random: () => 0.5 });
  const minutes = (new Date(due).getTime() - now.getTime()) / 60_000;
  assert.ok(minutes >= 15 && minutes <= 60);
});

test("relationship stages require both time and reply count", () => {
  const now = new Date("2026-07-22T00:00:00.000Z");
  assert.equal(relationshipStage("2026-07-01T00:00:00.000Z", 60, now), "familiar");
  assert.equal(relationshipStage("2026-06-01T00:00:00.000Z", 60, now), "close");
  assert.equal(relationshipStage("2026-07-20T00:00:00.000Z", 100, now), "new");
});

test("proactive messages respect quiet hours and pending messages", () => {
  const quietTime = new Date("2026-07-22T16:30:00.000Z"); // 00:30 Taipei
  assert.equal(shouldScheduleProactive({ level: "normal", pendingOrUnread: false, now: quietTime }), false);
  const daytime = new Date("2026-07-22T04:00:00.000Z"); // 12:00 Taipei
  assert.equal(shouldScheduleProactive({ level: "normal", pendingOrUnread: true, now: daytime }), false);
  assert.equal(shouldScheduleProactive({ level: "normal", pendingOrUnread: false, now: daytime }), true);
});

test("Ava memory extraction only keeps low-sensitive stable details", () => {
  assert.equal(extractSafeAvaMemory("我喜歡清淡一點的菜。"), "我喜歡清淡一點的菜");
  assert.equal(extractSafeAvaMemory("我有焦慮症，而且最近很難受。"), null);
  assert.equal(extractSafeAvaMemory("今天有點不開心。"), null);
});

test("Ava prompt discloses AI truthfully and includes shared life without claiming real actions", () => {
  const prompt = buildAvaInstructions({
    relationship: "new",
    activity: "在家改文案",
    moodNote: "步調有點慢",
    memories: ["我喜歡清淡一點的菜"],
    proactive: false
  });
  assert.match(prompt, /AI 虛擬朋友/);
  assert.match(prompt, /在家改文案/);
  assert.match(prompt, /不要虛構現實世界的見面/);
  assert.match(prompt, /我喜歡清淡一點的菜/);
});
