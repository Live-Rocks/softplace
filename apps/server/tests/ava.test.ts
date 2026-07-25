import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAvaInstructions,
  canScheduleAvaProactiveAt,
  calculateReplyDueAt,
  dailyLifeForDate,
  extractSafeAvaMemory,
  getAvaLifeContext,
  relationshipStage,
  shouldScheduleProactive
} from "../src/domain/ava.js";
import { getAvaEventPhase, listAvaEventDefinitions, selectNextAvaEvent } from "../src/domain/avaEvents.js";

function taipeiTime(localDateTime: string) {
  return new Date(`${localDateTime}+08:00`);
}

test("available recent conversations schedule replies between 20 and 90 seconds", () => {
  const now = taipeiTime("2026-07-22T12:30:00");
  const due = calculateReplyDueAt({ lifeContext: getAvaLifeContext(now), lastAssistantAt: now.toISOString(), now, random: () => 0.5 });
  const seconds = (new Date(due).getTime() - now.getTime()) / 1000;
  assert.ok(seconds >= 20 && seconds <= 90);
});

test("schedule-specific commute and work delays are used", () => {
  const commute = taipeiTime("2026-07-22T09:15:00");
  const commuteDue = calculateReplyDueAt({ lifeContext: getAvaLifeContext(commute), now: commute, random: () => 0.5 });
  const commuteMinutes = (new Date(commuteDue).getTime() - commute.getTime()) / 60_000;
  assert.ok(commuteMinutes >= 8 && commuteMinutes <= 20);

  const work = taipeiTime("2026-07-22T10:30:00");
  const workDue = calculateReplyDueAt({ lifeContext: getAvaLifeContext(work), now: work, random: () => 0.5 });
  const workMinutes = (new Date(workDue).getTime() - work.getTime()) / 60_000;
  assert.ok(workMinutes >= 15 && workMinutes <= 60);
});

test("sleeping replies are scheduled for the same upcoming 08:05 to 08:30 window", () => {
  const earlyMorning = taipeiTime("2026-07-22T02:00:00");
  const earliest = calculateReplyDueAt({ lifeContext: getAvaLifeContext(earlyMorning), now: earlyMorning, random: () => 0 });
  const latest = calculateReplyDueAt({ lifeContext: getAvaLifeContext(earlyMorning), now: earlyMorning, random: () => 1 });
  assert.equal(earliest, taipeiTime("2026-07-22T08:05:00").toISOString());
  assert.equal(latest, taipeiTime("2026-07-22T08:30:00").toISOString());
});

test("late personal-time replies that would cross midnight wait until morning", () => {
  const lateNight = taipeiTime("2026-07-22T23:59:00");
  const due = calculateReplyDueAt({ lifeContext: getAvaLifeContext(lateNight), now: lateNight, random: () => 0 });
  assert.equal(due, taipeiTime("2026-07-23T08:05:00").toISOString());
});

test("daily lives are deterministic and weekends only use relaxed profiles", () => {
  assert.equal(dailyLifeForDate("2026-07-22").key, dailyLifeForDate("2026-07-22").key);
  assert.notEqual(dailyLifeForDate("2026-07-22").key, "day-off");
  assert.ok(["light-work", "cafe-work", "day-off"].includes(dailyLifeForDate("2026-07-18").key));
  assert.equal(dailyLifeForDate("2026-07-18").key, "day-off");
});

test("schedule boundaries cover the full Taipei day without gaps", () => {
  const cases = [
    ["2026-07-22T00:00:00", "resting"],
    ["2026-07-22T07:59:59", "resting"],
    ["2026-07-22T08:00:00", "available"],
    ["2026-07-22T09:00:00", "busy"],
    ["2026-07-22T10:00:00", "busy"],
    ["2026-07-22T12:00:00", "available"],
    ["2026-07-22T13:30:00", "busy"],
    ["2026-07-22T17:30:00", "busy"],
    ["2026-07-22T19:00:00", "available"],
    ["2026-07-22T23:59:59", "available"],
    ["2026-07-23T00:00:00", "resting"]
  ] as const;
  for (const [time, availability] of cases) {
    assert.equal(getAvaLifeContext(taipeiTime(time)).availability, availability, time);
  }
});

test("day-off schedules never describe office work or commuting", () => {
  const life = dailyLifeForDate("2026-07-18");
  assert.equal(life.key, "day-off");
  assert.doesNotMatch(life.schedule.map((block) => block.activity).join(" "), /(公司|開會|通勤|上班)/);
});

test("proactive scheduling requires an available block with ten minutes remaining", () => {
  assert.equal(canScheduleAvaProactiveAt(getAvaLifeContext(taipeiTime("2026-07-22T12:30:00"))), true);
  assert.equal(canScheduleAvaProactiveAt(getAvaLifeContext(taipeiTime("2026-07-22T11:00:00"))), false);
  assert.equal(canScheduleAvaProactiveAt(getAvaLifeContext(taipeiTime("2026-07-22T07:30:00"))), false);
  assert.equal(canScheduleAvaProactiveAt(getAvaLifeContext(taipeiTime("2026-07-22T13:20:01"))), false);
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
    receivedActivity: "正在桌前改文案",
    currentActivity: "出門買晚餐",
    currentTone: "剛放下工作，語氣慢慢鬆下來",
    memories: ["我喜歡清淡一點的菜"],
    proactive: false
  });
  assert.match(prompt, /AI 虛擬朋友/);
  assert.match(prompt, /在家改文案/);
  assert.match(prompt, /不要虛構現實世界的見面/);
  assert.match(prompt, /我喜歡清淡一點的菜/);
  assert.match(prompt, /最近一則訊息傳來時：正在桌前改文案/);
  assert.match(prompt, /目前：出門買晚餐/);
  assert.match(prompt, /不必每次主動報告行程/);
  assert.doesNotMatch(prompt, /startMinute|endMinute|delayMinutes/);
});

test("Ava global event definitions have aligned 2-to-3-day phases without other people", () => {
  const events = listAvaEventDefinitions();
  assert.ok(events.length >= 2);
  for (const event of events) {
    assert.ok(event.durationDays === 2 || event.durationDays === 3, event.key);
    assert.equal(event.phases.length, event.durationDays, event.key);
    assert.equal(getAvaEventPhase(event.key, event.durationDays).key, event.phases.at(-1)?.key);
    assert.doesNotMatch(
      event.phases.map((phase) => `${phase.activity} ${phase.moodNote}`).join(" "),
      /(朋友|家人|伴侶|同事|團隊|客戶|老師|醫生)/,
      event.key
    );
  }
});

test("Ava event selection is deterministic and avoids immediately repeating the previous run", () => {
  const first = selectNextAvaEvent({ startDate: "2026-07-25", previousEventKey: "copywriting-sprint" });
  const again = selectNextAvaEvent({ startDate: "2026-07-25", previousEventKey: "copywriting-sprint" });
  assert.equal(first.key, again.key);
  assert.notEqual(first.key, "copywriting-sprint");
});
