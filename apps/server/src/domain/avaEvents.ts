export type AvaEventPhase = {
  key: string;
  activity: string;
  moodNote: string;
};

export type AvaEventDefinition = {
  key: string;
  durationDays: 2 | 3;
  phases: readonly AvaEventPhase[];
};

const eventDefinitions: readonly AvaEventDefinition[] = [
  {
    key: "brand-proposal-revision",
    durationDays: 3,
    phases: [
      { key: "outline", activity: "整理一份品牌提案的主軸", moodNote: "腦袋慢慢進入狀態，想把方向理清楚" },
      { key: "revision", activity: "根據收到的修改重新調整提案", moodNote: "有點卡住，但方向比昨天更清楚" },
      { key: "delivery", activity: "把提案收成最後一版並送出", moodNote: "終於能慢慢鬆一口氣" }
    ]
  },
  {
    key: "photo-final-pass",
    durationDays: 2,
    phases: [
      { key: "review", activity: "整理照片與畫面順序", moodNote: "眼睛有點累，還是想把細節看好" },
      { key: "polish", activity: "把照片和文字的細節收好", moodNote: "事情接近收尾，心裡比較安定" }
    ]
  },
  {
    key: "copywriting-sprint",
    durationDays: 2,
    phases: [
      { key: "rewrite", activity: "改寫一段內容文案", moodNote: "反覆換句子，想找到更剛好的語氣" },
      { key: "refine", activity: "收整語氣和最後幾個段落", moodNote: "慢慢有了收束感，不再那麼急" }
    ]
  },
  {
    key: "cafe-final-pass",
    durationDays: 2,
    phases: [
      { key: "focus", activity: "帶著電腦到咖啡店專心處理最後一版", moodNote: "外面有點吵，反而讓人比較專心" },
      { key: "wrap-up", activity: "把最後一版收好，慢慢離開咖啡店", moodNote: "完成了一段專注，想讓腦袋靜一靜" }
    ]
  },
  {
    key: "reset-weekend",
    durationDays: 2,
    phases: [
      { key: "tidy", activity: "整理房間和桌上的小東西", moodNote: "步調很慢，只想先把眼前弄舒服" },
      { key: "walk", activity: "出門走走，讓自己慢慢休息", moodNote: "沒有特別安排，想讓一天自然發生" }
    ]
  }
];

export function listAvaEventDefinitions() {
  return eventDefinitions;
}

export function getAvaEventDefinition(key: string) {
  const event = eventDefinitions.find((candidate) => candidate.key === key);
  if (!event) throw new Error(`unknown_ava_event:${key}`);
  return event;
}

export function getAvaEventPhase(key: string, eventDay: number) {
  const event = getAvaEventDefinition(key);
  const phase = event.phases[eventDay - 1];
  if (!phase) throw new Error(`unknown_ava_event_phase:${key}:${eventDay}`);
  return phase;
}

export function selectNextAvaEvent(input: { startDate: string; previousEventKey?: string | null }) {
  const seed = stableHash(`${input.startDate}:${input.previousEventKey ?? ""}`);
  const start = seed % eventDefinitions.length;

  for (let offset = 0; offset < eventDefinitions.length; offset += 1) {
    const candidate = eventDefinitions[(start + offset) % eventDefinitions.length]!;
    if (candidate.key !== input.previousEventKey) return candidate;
  }

  return eventDefinitions[0]!;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
