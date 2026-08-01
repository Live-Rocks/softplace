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
import {
  buildAvaEventDetailInput,
  buildAvaEventDetailInstructions,
  eventBackgroundFallback,
  getAvaEventDefinition,
  getAvaEventPhase,
  listAvaEventDefinitions,
  selectNextAvaEvent,
  validateAvaEventDetail
} from "../src/domain/avaEvents.js";

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
    eventContext: {
      title: "文案改寫",
      day: 1,
      activity: "改寫一段內容文案",
      moodNote: "在不同句子之間找更剛好的語氣",
      progress: "語氣開始靠近想要的方向，還在慢慢試",
      completion: "begin"
    },
    eventBackground: "今天慢慢把一段文案收整到比較安靜的狀態。",
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
  assert.match(prompt, /偶爾可帶出的具體生活片刻/);
  assert.match(prompt, /持續事件骨架/);
  assert.match(prompt, /文案改寫，第 1 天/);
  assert.match(prompt, /今天是改寫一段內容文案/);
  assert.match(prompt, /事件底色：在不同句子之間找更剛好的語氣/);
  assert.match(prompt, /不要重述、報進度/);
  assert.match(prompt, /不代表這件事仍在持續未完/);
  assert.doesNotMatch(prompt, /startMinute|endMinute|delayMinutes/);
});

test("Ava global event definitions balance work and life with a clear ending", () => {
  const events = listAvaEventDefinitions();
  assert.ok(events.length >= 10);
  assert.equal(events.filter((event) => event.category === "work").length, events.filter((event) => event.category === "life").length);
  for (const event of events) {
    assert.ok(event.durationDays === 2 || event.durationDays === 3, event.key);
    assert.ok(event.title.length > 0, event.key);
    assert.ok(event.anchorTerms.length > 0, event.key);
    assert.equal(event.phases.length, event.durationDays, event.key);
    assert.equal(getAvaEventPhase(event.key, event.durationDays).key, event.phases.at(-1)?.key);
    assert.ok(["complete", "transition"].includes(event.phases.at(-1)?.completion ?? ""), event.key);
    assert.doesNotMatch(
      event.phases.map((phase) => `${phase.activity} ${phase.moodNote} ${phase.scene} ${phase.visibleDetails.join(" ")}`).join(" "),
      /(朋友|家人|伴侶|同事|團隊|客戶|老師|醫生)/,
      event.key
    );
    for (const phase of event.phases) {
      assert.ok(phase.visibleDetails.length > 0, `${event.key}:${phase.key}`);
      assert.ok(phase.scene.length > 0, `${event.key}:${phase.key}`);
      assert.ok(phase.progress.length > 0, `${event.key}:${phase.key}`);
    }
  }
});

test("Ava event selection is deterministic, avoids the last three runs, and rebalances categories", () => {
  const input = {
    startDate: "2026-07-25",
    recentEventKeys: ["brand-proposal-revision", "photo-final-pass", "copywriting-sprint"]
  };
  const first = selectNextAvaEvent(input);
  const again = selectNextAvaEvent(input);
  assert.equal(first.key, again.key);
  assert.ok(!input.recentEventKeys.includes(first.key));
  assert.equal(first.category, "life");
});

test("Ava event daily detail input includes concrete scene clues and a same-run previous detail", () => {
  const prompt = buildAvaEventDetailInput({
    eventKey: "copywriting-sprint",
    eventDay: 2,
    phaseKey: "refine",
    activity: "把文案讀過一遍後定下最後版本",
    moodNote: "不再那麼急，想讓它停在剛好的地方",
    eventTitle: "文案改寫",
    anchorTerms: ["文案", "句子", "段落"],
    scene: "從頭默讀一遍，把最後兩個句子的節奏換得更乾淨",
    visibleDetails: ["被標記的兩句話", "闔上的筆記本"],
    progress: "今天這段文字已經定下來，先把它留在這裡",
    completion: "complete",
    previousDetail: "昨天先把零散的句子重新排過一次。"
  });
  assert.match(prompt, /第 2 天/);
  assert.match(prompt, /文案改寫/);
  assert.match(prompt, /必須保留的事件錨點之一：文案、句子、段落/);
  assert.match(prompt, /昨天先把零散的句子/);
  assert.match(prompt, /可見線索：被標記的兩句話、闔上的筆記本/);
  assert.match(buildAvaEventDetailInstructions(), /匿名互動限店員、櫃台、路人或店家/);
  assert.match(buildAvaEventDetailInstructions(), /至少一個可觀察的小片刻/);
  assert.equal(eventBackgroundFallback({ activity: "整理桌面", moodNote: "步調很慢" }), "今天正在整理桌面，心情是步調很慢。");
});

test("Ava event daily detail preserves event anchors and rejects relationships, direct address, and invalid lengths", () => {
  assert.equal(validateAvaEventDetail("把幾樣蔬菜放進購物籃後，櫃台結帳時又核對了一次袋裡的東西。", ["蔬菜", "食材"]), "把幾樣蔬菜放進購物籃後，櫃台結帳時又核對了一次袋裡的東西。");
  assert.equal(validateAvaEventDetail("把幾樣東西放進購物籃後，櫃台結帳時又核對了一次袋裡的東西。", ["蔬菜", "食材"]), null);
  assert.equal(validateAvaEventDetail("今天和朋友一起整理內容，心裡比較不急。"), null);
  assert.equal(validateAvaEventDetail("你今天可以陪我一起把內容整理好。"), null);
  assert.equal(validateAvaEventDetail("店員說「今天很熱」，把飲料放到桌邊。"), null);
  assert.equal(validateAvaEventDetail("今天先把內容重新排過一次。接著停下來看了看語氣。最後又改了幾句。"), null);
  assert.equal(validateAvaEventDetail("太短。"), null);
});

test("Ava keeps established event keys resolvable for existing global runs", () => {
  assert.equal(getAvaEventDefinition("copywriting-sprint").title, "文案改寫");
  assert.equal(getAvaEventDefinition("brand-proposal-revision").title, "品牌提案修改");
  assert.equal(getAvaEventDefinition("reset-weekend").title, "週末整理散步");
});
