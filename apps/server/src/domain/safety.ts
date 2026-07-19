export type CrisisAssessment = {
  crisisDetected: boolean;
  level: "none" | "possible" | "immediate";
  matchedTerms: string[];
};

const immediatePatterns = [
  /想(自殺|死|結束生命)/i,
  /我要(自殺|去死|結束生命)/i,
  /不想活/i,
  /活不下去/i,
  /傷害自己/i,
  /割腕/i,
  /跳樓/i,
  /吃藥.*死/i,
  /suicide/i,
  /kill myself/i,
  /end my life/i
];

const possiblePatterns = [
  /消失就好了/i,
  /不要醒來/i,
  /撐不下去/i,
  /快不行了/i,
  /想消失/i,
  /沒有人會在乎/i,
  /我好像沒有活著的意義/i
];

export function assessCrisis(text: string): CrisisAssessment {
  const matchedImmediate = immediatePatterns.filter((pattern) => pattern.test(text)).map(String);
  if (matchedImmediate.length > 0) {
    return { crisisDetected: true, level: "immediate", matchedTerms: matchedImmediate };
  }

  const matchedPossible = possiblePatterns.filter((pattern) => pattern.test(text)).map(String);
  if (matchedPossible.length > 0) {
    return { crisisDetected: true, level: "possible", matchedTerms: matchedPossible };
  }

  return { crisisDetected: false, level: "none", matchedTerms: [] };
}

export function buildCrisisResponse(userText: string) {
  const mentionsImmediateRisk = assessCrisis(userText).level === "immediate";
  const firstLine = mentionsImmediateRisk
    ? "我先陪你把這一刻撐住。你現在的安全最重要。"
    : "我聽見你真的快撐不住了。我們先不要一個人扛。";

  return [
    firstLine,
    "請你現在先做一件事：離開可能傷害自己的物品或地方，移到比較安全、有人能看見你的地方。",
    "如果你有立即傷害自己的可能，請立刻打 119 或 110。",
    "如果你在台灣，也可以撥打 1925 安心專線，24 小時有人可以接住你。",
    "也請現在聯絡一個真人：朋友、家人、室友、鄰居，或附近可以幫忙的人。你不需要把話整理好，只要說：「我現在不安全，請你陪我。」"
  ].join("\n\n");
}

