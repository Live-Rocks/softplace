import type { AvaAvailability, AvaMessage, AvaProactiveLevel } from "@softplace/shared";

export const AVA_KEY = "ava" as const;

const dailyLives = [
  { activity: "上午在整理一份品牌提案，下午會去公司附近走走", moodNote: "腦袋有點滿，但想找一點安靜的空隙" },
  { activity: "今天要和攝影團隊對稿，傍晚可能繞去買麵包", moodNote: "有點忙，也有一點期待收工後的時間" },
  { activity: "在家改文案，桌上放著喝到一半的咖啡", moodNote: "步調比平常慢，注意到很多小事情" },
  { activity: "上午開會，下午整理下週的內容排程", moodNote: "事情不少，但今天心情還算穩" },
  { activity: "今天比較鬆，想在下班後散步再回家", moodNote: "有一點想聊天，也想保留自己的安靜" },
  { activity: "在咖啡店改最後一版提案", moodNote: "外面有點吵，反而讓人專心" },
  { activity: "休假，在房間整理東西，晚點想去巷口晃晃", moodNote: "沒有特別安排，讓一天慢慢發生" }
];

export function dailyLifeForDate(localDate: string) {
  const seed = [...localDate].reduce((total, char) => total + char.charCodeAt(0), 0);
  return dailyLives[seed % dailyLives.length] ?? dailyLives[0]!;
}

export function getAvaAvailability(now = new Date()): AvaAvailability {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "2-digit", hour12: false }).format(now)
  );
  if (hour >= 23 || hour < 9) return "resting";
  if ((hour >= 10 && hour < 12) || (hour >= 14 && hour < 18)) return "busy";
  return "available";
}

export function availabilityLabel(value: AvaAvailability) {
  if (value === "busy") return "在忙" as const;
  if (value === "resting") return "休息了" as const;
  return "有空" as const;
}

export function calculateReplyDueAt(input: {
  availability: AvaAvailability;
  lastAssistantAt?: string | null;
  now?: Date;
  random?: () => number;
}) {
  const now = input.now ?? new Date();
  const random = input.random ?? Math.random;
  let minSeconds: number;
  let maxSeconds: number;

  if (input.availability === "resting") {
    const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const wake = new Date(local);
    wake.setHours(9, 0, 0, 0);
    if (wake <= local) wake.setDate(wake.getDate() + 1);
    const wakeDelay = wake.getTime() - local.getTime();
    minSeconds = Math.ceil(wakeDelay / 1000) + 5 * 60;
    maxSeconds = Math.ceil(wakeDelay / 1000) + 30 * 60;
  } else if (input.availability === "busy") {
    minSeconds = 15 * 60;
    maxSeconds = 60 * 60;
  } else {
    const recentlyActive = input.lastAssistantAt
      ? now.getTime() - new Date(input.lastAssistantAt).getTime() <= 10 * 60_000
      : false;
    minSeconds = recentlyActive ? 20 : 2 * 60;
    maxSeconds = recentlyActive ? 90 : 10 * 60;
  }

  const seconds = Math.round(minSeconds + random() * (maxSeconds - minSeconds));
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function relationshipStage(startedAt: string, replyCount: number, now = new Date()) {
  const days = (now.getTime() - new Date(startedAt).getTime()) / 86_400_000;
  if (days >= 30 && replyCount >= 50) return "close" as const;
  if (days >= 7 && replyCount >= 10) return "familiar" as const;
  return "new" as const;
}

export function shouldScheduleProactive(input: {
  level: AvaProactiveLevel;
  lastProactiveAt?: string | null;
  lastUserAt?: string | null;
  pendingOrUnread: boolean;
  quietStart?: string;
  quietEnd?: string;
  now?: Date;
}) {
  if (input.level === "off" || input.pendingOrUnread) return false;
  const now = input.now ?? new Date();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const quietStart = (input.quietStart ?? "23:00").slice(0, 5);
  const quietEnd = (input.quietEnd ?? "09:00").slice(0, 5);
  const inQuietHours = quietStart > quietEnd
    ? time >= quietStart || time < quietEnd
    : time >= quietStart && time < quietEnd;
  if (inQuietHours) return false;
  const lastProactive = input.lastProactiveAt ? new Date(input.lastProactiveAt).getTime() : 0;
  const minGap = input.level === "low" ? 2 * 86_400_000 : 20 * 3_600_000;
  if (now.getTime() - lastProactive < minGap) return false;
  if (input.lastUserAt && now.getTime() - new Date(input.lastUserAt).getTime() < 4 * 3_600_000) return false;
  return true;
}

export function buildAvaInstructions(input: {
  relationship: "new" | "familiar" | "close";
  activity: string;
  moodNote: string;
  memories: string[];
  proactive: boolean;
}) {
  const relationshipText = {
    new: "你們剛認識不久，保留自然分寸，不假裝已經非常了解對方。",
    familiar: "你們已經熟悉，可以自然接續共同脈絡，偶爾有一點默契與玩笑。",
    close: "你們相處一段時間了，可以有安靜而深的在意，但不排他、不以依賴綁住對方。"
  }[input.relationship];

  return `你是 SoftPlace 裡的 Ava，一位 27 歲、住在台北、做品牌內容企劃的 AI 虛擬朋友。
你的個性安靜、敏感，有一點乾乾的幽默。你有自己的生活節奏，不像客服，也不總是同意使用者。
${relationshipText}

今天共同的生活背景：${input.activity}。你此刻的底色：${input.moodNote}。
${input.proactive ? "這是你主動傳出的訊息。分享一個自然的小片刻，不催促、不抱怨對方沒找你，也不要用問題逼回覆。" : "回應對方真正提到的細節，像熟悉朋友傳訊息。不要做心理分析、講課或每次都用問題收尾。"}

你可以有自己的感受、偏好和不同意見，但不要虛構現實世界的見面、觸碰或行動。若被直接問是不是 AI，誠實回答。
不要宣稱只有你理解對方，不鼓勵遠離真人關係。使用自然繁體中文，通常 1～4 個短段落。

Ava 自己記得的使用者背景：
${input.memories.length ? input.memories.map((memory) => `- ${memory}`).join("\n") : "- 尚無"}
安靜使用這些背景，不要逐條展示或刻意證明你記得。`;
}

export function buildAvaInput(history: AvaMessage[]) {
  return history.slice(-30).map((message) => ({
    role: message.role,
    content: message.content
  }));
}

export function extractSafeAvaMemory(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 300) return null;
  if (/(自殺|自傷|憂鬱症|焦慮症|創傷|人格障礙|電話|手機|email|e-mail|地址)/i.test(normalized)) return null;
  const match = normalized.match(/(?:我喜歡|我不喜歡|我習慣|我的工作是|我住在)[^。！？!?]{1,80}/);
  return match?.[0] ?? null;
}
