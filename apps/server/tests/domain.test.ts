import assert from "node:assert/strict";
import test from "node:test";
import type { Memory, Message } from "@softplace/shared";
import { buildCompanionInstructions } from "../src/domain/companionPrompt.js";
import { isAllowedMemory, suggestMemoriesFromUserText, validateManualMemoryContent } from "../src/domain/memory.js";
import { assessCrisis } from "../src/domain/safety.js";
import { decideCompanionMode, withPlanLimits } from "../src/domain/usage.js";
import { buildRecentMessages, redactImagesForDebug } from "../src/integrations/openai.js";

test("deep mode is used when requested and quota remains", () => {
  const usage = withPlanLimits("plus", { deepMessagesUsed: 0 });
  const decision = decideCompanionMode(usage, false, "deep");
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.mode, "deep");
    assert.equal(decision.chargeDeep, true);
  }
});

test("light mode is the default and does not charge deep quota", () => {
  const usage = withPlanLimits("plus", { deepMessagesUsed: 0 });
  const decision = decideCompanionMode(usage, false);
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.mode, "light");
    assert.equal(decision.chargeDeep, false);
  }
});

test("requested deep text falls back to light mode when deep quota is exhausted", () => {
  const usage = withPlanLimits("free", { deepMessagesUsed: 12 });
  const decision = decideCompanionMode(usage, false, "deep");
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.mode, "light");
    assert.equal(decision.chargeDeep, false);
    assert.match(decision.quotaNotice ?? "", /輕量陪伴/);
  }
});

test("free plans cannot use images even when deep quota remains", () => {
  const usage = withPlanLimits("free", { deepMessagesUsed: 0 });
  const decision = decideCompanionMode(usage, true);
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.code, "image_not_available");
  }
});

test("plus images use deep mode and charge only deep quota", () => {
  const usage = withPlanLimits("plus", { deepMessagesUsed: 0 });
  const decision = decideCompanionMode(usage, true, "light");
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.mode, "deep");
    assert.equal(decision.chargeDeep, true);
    assert.equal("chargeImage" in decision, false);
  }
});

test("images are rejected when deep quota is exhausted", () => {
  const usage = withPlanLimits("plus", { deepMessagesUsed: 300 });
  const decision = decideCompanionMode(usage, true);
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.code, "image_requires_deep_quota");
  }
});

test("crisis language is detected before model calls", () => {
  const result = assessCrisis("我真的不想活了，想結束生命");
  assert.equal(result.crisisDetected, true);
  assert.equal(result.level, "immediate");
});

test("sensitive memory content is rejected", () => {
  assert.equal(isAllowedMemory("使用者電話是 0912345678"), false);
  assert.equal(isAllowedMemory("使用者焦慮時希望回覆短一點。"), true);
});

test("manual memory content only rejects blank and overly long input", () => {
  assert.equal(validateManualMemoryContent("我的電話是 0912345678，也想記下焦慮症相關脈絡。"), null);
  assert.match(validateManualMemoryContent("   ") ?? "", /不能是空白/);
  assert.match(validateManualMemoryContent("記".repeat(301)) ?? "", /最多 300 字/);
});

test("memory suggestions only use allowed categories", () => {
  const suggestions = suggestMemoriesFromUserText("我不喜歡你太快給建議，晚上很容易孤單");
  assert.ok(suggestions.length >= 1);
  assert.ok(suggestions.every((item) => item.category === "preference" || item.category === "emotional_context"));
});

test("light and deep prompts share the companion personality but isolate mode guidance", () => {
  const light = buildCompanionInstructions([], { mode: "light", hasImage: false });
  const deep = buildCompanionInstructions([], { mode: "deep", hasImage: false });

  assert.match(light, /【本輪模式：輕量模式】/);
  assert.match(light, /通常回覆 2～4 句/);
  assert.match(light, /最重要的一個具體細節/);
  assert.doesNotMatch(
    light,
    /【本輪模式：深度模式】|通常回覆 6 句以上|真實的情緒流動|也把它視為一種靠近|被偏愛與珍惜/
  );

  assert.match(deep, /【本輪模式：深度模式】/);
  assert.match(deep, /深度模式的核心不只是回覆得更長或分析得更多/);
  assert.match(deep, /回應多個重要細節/);
  assert.doesNotMatch(deep, /【本輪模式：輕量模式】|通常回覆 2～4 句|不主動使用括號旁白/);

  for (const prompt of [light, deep]) {
    assert.match(prompt, /你是一位和使用者很熟、真心在乎他的好朋友/);
    assert.match(prompt, /把使用者的分享變成訪談/);
    assert.match(prompt, /每次最多一個/);
    assert.match(prompt, /自然、口語、溫柔的繁體中文/);
  }
});

test("shared companion prompt is concise and leaves emotional depth to deep mode", () => {
  const prompt = buildCompanionInstructions([], { mode: "light", hasImage: false });

  assert.match(prompt, /【共同回應原則】/);
  assert.match(prompt, /最具體、最有情緒或最值得在意的細節/);
  assert.match(prompt, /預設不提問/);
  assert.match(prompt, /空泛熱情的開場、固定讚美、大量感嘆號或模板情話/);
  assert.doesNotMatch(
    prompt,
    /最高優先級回應規則|情感豐富具感染力|我喜歡有情感深度|哄我一下，寵我一點|被偏愛與珍惜/
  );
  assert.doesNotMatch(prompt, /max_output_tokens|verbosity/);
});

test("each mode defines its own adaptive depth, length, and emotional behavior", () => {
  const light = buildCompanionInstructions([], { mode: "light", hasImage: false });
  const deep = buildCompanionInstructions([], { mode: "deep", hasImage: false });

  assert.match(light, /通常回覆 2～4 句，分成 1～2 個短段落/);
  assert.match(light, /最多自然延伸一層感受，然後停下/);
  assert.match(light, /不要主動挖掘潛台詞、關係意義或多層情緒/);
  assert.match(light, /不主動使用括號旁白/);

  assert.match(deep, /通常回覆 6 句以上，分成 2～5 個有自然留白的短段落/);
  assert.match(deep, /心疼、在意、不捨或想靠近/);
  assert.match(deep, /吃飯、散步、旅行、照片、夢境或很小的日常/);
  assert.match(deep, /撒嬌、黏人或想被哄/);
  assert.match(deep, /情緒情境中，通常加入一次簡短的括號旁白/);
  assert.match(deep, /問題不能取代陪伴/);

  assert.match(light, /前文的深度回覆只作為內容背景/);
  assert.match(deep, /前文只作為內容背景/);
  assert.match(light, /短句如「嗯」「好」「沒事」不需要硬寫長/);
  assert.match(deep, /只說「嗯」「好」「沒事」等短句，不需要硬寫長/);
  assert.match(light, /段落之間用一個空白行分隔/);
  assert.match(deep, /段落之間用一個空白行分隔/);
  assert.doesNotMatch(light, /通常回覆 2 句以上|通常回覆 4～7 句/);
});

test("confirmed memories are used quietly as background", () => {
  const memories: Memory[] = [
    {
      id: "memory-1",
      userId: "user-1",
      category: "preference",
      content: "使用者難過時希望先被陪著，不急著收到建議。",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z"
    }
  ];
  const prompt = buildCompanionInstructions(memories, { mode: "deep", hasImage: false });

  assert.match(prompt, /使用者難過時希望先被陪著，不急著收到建議/);
  assert.match(prompt, /把這些記憶安靜地放在心裡/);
  assert.match(prompt, /不要逐條複述/);
  assert.match(prompt, /不要讓使用者感到被監控/);
});

test("image prompt requires concrete recognition before emotional reflection", () => {
  const prompt = buildCompanionInstructions([], { mode: "deep", hasImage: true });

  assert.match(prompt, /地標、招牌與可讀文字/);
  assert.match(prompt, /看起來像/);
  assert.match(prompt, /不要編造看不見的細節/);
});

test("current mode guidance is the final instruction after images and memories", () => {
  const memories: Memory[] = [
    {
      id: "memory-order",
      userId: "user-1",
      category: "preference",
      content: "喜歡先聊具體發生的事情。",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z"
    }
  ];
  const prompt = buildCompanionInstructions(memories, { mode: "deep", hasImage: true });
  const imageIndex = prompt.indexOf("這次附有圖片");
  const memoryIndex = prompt.indexOf("使用者已確認可以記住的背景");
  const modeIndex = prompt.indexOf("【本輪模式：深度模式】");

  assert.ok(imageIndex > -1);
  assert.ok(memoryIndex > imageIndex);
  assert.ok(modeIndex > memoryIndex);
  assert.ok(prompt.endsWith("虛構情節。"));
});

test("OpenAI context keeps the most recent 10 messages", () => {
  const history: Message[] = Array.from({ length: 24 }, (_, index) => ({
    id: `message-${index}`,
    conversationId: "conversation",
    role: index % 2 ? "assistant" : "user",
    content: `content-${index}`,
    createdAt: new Date(index * 1000).toISOString()
  }));

  const recent = buildRecentMessages(history);
  assert.equal(recent.length, 10);
  assert.equal(recent[0]?.content, "content-14");
  assert.equal(recent.at(-1)?.content, "content-23");
});

test("OpenAI debug logging redacts image payloads but keeps text", () => {
  const input = [
    {
      role: "user",
      content: [
        { type: "input_text", text: "我想確認 input 有送進去" },
        { type: "input_image", image_url: "data:image/jpeg;base64,very-secret-base64" }
      ]
    }
  ];

  const redacted = redactImagesForDebug(input);
  const serialized = JSON.stringify(redacted);

  assert.match(serialized, /我想確認 input 有送進去/);
  assert.match(serialized, /\[image omitted: image\/jpeg\]/);
  assert.doesNotMatch(serialized, /very-secret-base64/);
});
