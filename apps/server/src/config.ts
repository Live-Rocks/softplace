import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 8787),
  appOrigin: process.env.APP_ORIGIN ?? "*",
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  aiProvider: process.env.AI_PROVIDER === "local" ? "local" : "openai",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiDeepModel: process.env.OPENAI_DEEP_MODEL ?? "gpt-5.4-mini",
  openAiLightModel: process.env.OPENAI_LIGHT_MODEL ?? "gpt-4o-mini",
  openAiLifeModel: process.env.OPENAI_LIFE_MODEL ?? "gpt-5.4-mini",
  openAiStoreResponses: parseBooleanEnv(process.env.OPENAI_STORE_RESPONSES),
  openAiDebugIo: parseBooleanEnv(process.env.OPENAI_DEBUG_IO),
  openAiTimeoutMs: parsePositiveIntegerEnv(process.env.OPENAI_TIMEOUT_MS, 60_000),
  openAiMaxRetries: parseNonNegativeIntegerEnv(process.env.OPENAI_MAX_RETRIES, 0),
  chatRateLimitPerMinute: parsePositiveIntegerEnv(process.env.CHAT_RATE_LIMIT_PER_MINUTE, 12),
  chatRateLimitPerHour: parsePositiveIntegerEnv(process.env.CHAT_RATE_LIMIT_PER_HOUR, 120),
  deepReservationTtlSeconds: parsePositiveIntegerEnv(process.env.DEEP_RESERVATION_TTL_SECONDS, 120),
  retrievalShadowEnabled: parseBooleanEnv(process.env.RETRIEVAL_SHADOW_ENABLED),
  retrievalShadowUserIds: new Set(
    (process.env.RETRIEVAL_SHADOW_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  ),
  avaFeatureEnabled: parseBooleanEnv(process.env.AVA_FEATURE_ENABLED),
  avaBetaUserIds: new Set(
    (process.env.AVA_BETA_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  ),
  avaDailyLimit: parsePositiveIntegerEnv(process.env.AVA_DAILY_LIMIT, 30),
  companionWorkerSecret: process.env.COMPANION_WORKER_SECRET ?? ""
};

function parseBooleanEnv(value: string | undefined) {
  return value?.toLowerCase() === "true";
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeIntegerEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function hasSupabaseConfig() {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

export function assertRuntimeConfig() {
  if (!hasSupabaseConfig()) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  if (config.aiProvider === "openai" && !config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai.");
  }
  if ((config.avaFeatureEnabled || config.retrievalShadowEnabled) && !config.companionWorkerSecret) {
    throw new Error("COMPANION_WORKER_SECRET is required when Ava or retrieval shadow is enabled.");
  }
}
