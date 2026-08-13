import "dotenv/config";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { supabaseAdmin } from "../integrations/supabase.js";

const labels = { m: "must", a: "acceptable", f: "forbidden", i: "irrelevant" } as const;

export async function main(argv = process.argv.slice(2)) {
  const userId = value(argv, "user-id");
  const limit = Number(value(argv, "limit") ?? 25);
  if (!userId || !Number.isInteger(limit) || limit < 1) throw new Error("valid --user-id and --limit are required");
  if (!config.retrievalShadowUserIds.has(userId)) throw new Error("user is not in RETRIEVAL_SHADOW_USER_IDS");
  if (!supabaseAdmin) throw new Error("Supabase configuration is required");
  const { data: runs, error } = await supabaseAdmin.from("retrieval_shadow_runs")
    .select("id,query_message_id,created_at").eq("user_id", userId).eq("status", "completed")
    .order("created_at", { ascending: true }).limit(limit * 3);
  if (error) throw new Error("shadow_review_read_failed");
  const rl = readline.createInterface({ input, output });
  let reviewed = 0;
  try {
    for (const run of runs ?? []) {
      if (reviewed >= limit) break;
      const { data: candidates, error: candidateError } = await supabaseAdmin.from("retrieval_shadow_candidates")
        .select("id,chunk_id,rank,score,review_label").eq("run_id", run.id).order("rank");
      if (candidateError) throw new Error("shadow_review_read_failed");
      if (!candidates?.length || candidates.every((candidate) => candidate.review_label)) continue;
      const { data: query } = await supabaseAdmin.from("messages").select("content").eq("id", run.query_message_id).single();
      console.info(`\nRun ${run.id}\nQuery: ${query?.content ?? "[missing]"}`);
      for (const candidate of candidates) {
        if (candidate.review_label) continue;
        const { data: chunk } = await supabaseAdmin.from("retrieval_chunks")
          .select("conversation_id,start_sequence,end_sequence").eq("id", candidate.chunk_id).single();
        const { data: source } = chunk
          ? await supabaseAdmin.from("messages").select("role,content,message_sequence")
              .eq("conversation_id", chunk.conversation_id)
              .gte("message_sequence", chunk.start_sequence).lte("message_sequence", chunk.end_sequence)
              .order("message_sequence", { ascending: true })
          : { data: null };
        const dialogue = (source ?? []).map((message) => `${message.role === "user" ? "使用者" : "安放"}：${message.content}`).join("\n");
        const answer = (await rl.question(`#${candidate.rank} score=${Number(candidate.score).toFixed(4)}\n${dialogue || "[missing]"}\n[m]ust [a]cceptable [f]orbidden [i]rrelevant: `)).trim().toLowerCase();
        const label = labels[answer as keyof typeof labels];
        if (!label) throw new Error("invalid review label");
        const { error: updateError } = await supabaseAdmin.from("retrieval_shadow_candidates")
          .update({ review_label: label, reviewed_at: new Date().toISOString() }).eq("id", candidate.id);
        if (updateError) throw new Error("shadow_review_write_failed");
      }
      reviewed += 1;
    }
  } finally {
    rl.close();
  }
  console.info("[retrieval-shadow:review]", { reviewedRuns: reviewed });
  return { reviewedRuns: reviewed };
}

function value(argv: string[], name: string) { return argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[retrieval-shadow:review] ${error instanceof Error ? error.message : "failed"}`); process.exitCode = 1; });
}
