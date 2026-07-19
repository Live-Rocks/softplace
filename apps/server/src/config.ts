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
  openAiStoreResponses: parseBooleanEnv(process.env.OPENAI_STORE_RESPONSES),
  openAiDebugIo: parseBooleanEnv(process.env.OPENAI_DEBUG_IO)
};

function parseBooleanEnv(value: string | undefined) {
  return value?.toLowerCase() === "true";
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
}
