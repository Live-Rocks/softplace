import type { CompanionMode, Plan, UsageState } from "@softplace/shared";

export const PLAN_LIMITS: Record<Plan, { deep: number; imageEnabled: boolean }> = {
  free: { deep: 12, imageEnabled: false },
  plus: { deep: 300, imageEnabled: true },
  pro: { deep: 900, imageEnabled: true }
};

export function currentUsageMonth(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function withPlanLimits(plan: Plan, partial?: Partial<UsageState>): UsageState {
  const limits = PLAN_LIMITS[plan];
  return {
    plan,
    month: partial?.month ?? currentUsageMonth(),
    deepMessagesUsed: partial?.deepMessagesUsed ?? 0,
    deepMessagesLimit: limits.deep
  };
}

export type ModeDecision =
  | { ok: true; mode: CompanionMode; chargeDeep: boolean; quotaNotice?: string }
  | { ok: false; code: "image_not_available" | "image_requires_deep_quota"; message: string };

export function decideCompanionMode(
  usage: UsageState,
  hasImage: boolean,
  requestedMode: CompanionMode = "light"
): ModeDecision {
  const deepRemaining = usage.deepMessagesLimit - usage.deepMessagesUsed;

  if (hasImage && !PLAN_LIMITS[usage.plan].imageEnabled) {
    return {
      ok: false,
      code: "image_not_available",
      message: "目前方案尚未開放圖片陪伴。你可以先用文字跟我說，我會繼續陪你。"
    };
  }

  if (hasImage && deepRemaining <= 0) {
    return {
      ok: false,
      code: "image_requires_deep_quota",
      message: "圖片陪伴需要剩餘的深度陪伴額度。你可以先用文字跟我說，我會繼續陪你。"
    };
  }

  if (hasImage) {
    return { ok: true, mode: "deep", chargeDeep: true };
  }

  if (requestedMode === "deep" && deepRemaining > 0) {
    return { ok: true, mode: "deep", chargeDeep: true };
  }

  if (requestedMode === "light") {
    return { ok: true, mode: "light", chargeDeep: false };
  }

  return {
    ok: true,
    mode: "light",
    chargeDeep: false,
    quotaNotice: "深度陪伴額度已用完，我會先切到輕量陪伴繼續陪你。"
  };
}
