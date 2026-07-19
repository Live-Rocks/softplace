import { createClient } from "@supabase/supabase-js";
import { config, hasSupabaseConfig } from "../config.js";

export const supabaseAdmin = hasSupabaseConfig()
  ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

