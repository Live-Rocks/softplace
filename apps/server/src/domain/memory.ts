import type { MemoryCategory, PendingMemorySuggestion } from "@softplace/shared";

export const manualMemoryMaxLength = 300;

const sensitivePatterns = [
  /身分證|身份證|護照|居留證|信用卡|電話|手機|地址|住址|email|電子信箱/i,
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
  /\b09\d{8}\b/,
  /很脆弱|很自卑|有病|人格障礙|憂鬱症|焦慮症|創傷/i
];

const categoryHints: Array<{ category: MemoryCategory; patterns: RegExp[] }> = [
  {
    category: "preference",
    patterns: [/不喜歡.*建議/i, /不要.*分析/i, /希望.*短/i, /喜歡.*哄/i, /不喜歡.*油膩/i]
  },
  {
    category: "emotional_context",
    patterns: [/晚上.*(低落|孤單|難過)/i, /最近.*(工作|壓力|失眠|焦慮)/i, /(工作|家人|感情).*壓力/i]
  }
];

export function isAllowedMemory(content: string) {
  const trimmed = content.trim();
  if (trimmed.length < 6 || trimmed.length > 120) return false;
  return !sensitivePatterns.some((pattern) => pattern.test(trimmed));
}

export function validateManualMemoryContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return "記憶內容不能是空白。";
  if (trimmed.length > manualMemoryMaxLength) return `記憶內容最多 ${manualMemoryMaxLength} 字。`;
  return null;
}

export function sanitizeMemoryContent(content: string) {
  return content.trim().replace(/\s+/g, " ");
}

export function normalizeMemoryCategory(category: string): MemoryCategory {
  return category === "emotional_context" ? "emotional_context" : "preference";
}

export function suggestMemoriesFromUserText(userText: string): PendingMemorySuggestion[] {
  const suggestions: PendingMemorySuggestion[] = [];

  for (const hint of categoryHints) {
    if (hint.patterns.some((pattern) => pattern.test(userText))) {
      const content =
        hint.category === "preference"
          ? summarizePreference(userText)
          : summarizeEmotionalContext(userText);
      if (isAllowedMemory(content)) {
        suggestions.push({ category: hint.category, content });
      }
    }
  }

  return suggestions.slice(0, 2);
}

function summarizePreference(userText: string) {
  if (/不要.*分析|不喜歡.*建議/i.test(userText)) return "使用者不喜歡太快被分析或給建議。";
  if (/希望.*短/i.test(userText)) return "使用者焦慮時希望回覆短一點。";
  if (/喜歡.*哄/i.test(userText)) return "使用者喜歡被溫柔安撫，但不需要油膩誇張。";
  return "使用者偏好先被接住，再慢慢整理下一步。";
}

function summarizeEmotionalContext(userText: string) {
  if (/晚上.*(低落|孤單|難過)/i.test(userText)) return "使用者晚上比較容易覺得低落或孤單。";
  if (/工作.*壓力|壓力.*工作/i.test(userText)) return "使用者最近有工作壓力。";
  if (/失眠/i.test(userText)) return "使用者最近睡眠狀態不太穩。";
  return "使用者最近有一段需要被溫柔承接的情緒脈絡。";
}
