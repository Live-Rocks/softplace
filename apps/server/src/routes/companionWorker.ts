import { Router } from "express";
import { config } from "../config.js";
import { buildAvaInput, buildAvaInstructions, extractSafeAvaMemory, relationshipStage } from "../domain/ava.js";
import {
  claimAvaJobs,
  completeAvaJob,
  getAvaJobContext,
  getPushTokens,
  newWorkerToken,
  retryAvaJob,
  saveAvaMemoryIfNew,
  scheduleEligibleProactiveJobs
} from "../integrations/avaRepository.js";
import { sendAvaPush } from "../integrations/expoPush.js";
import { generateAvaReply } from "../integrations/openai.js";

export function companionWorkerRouter() {
  const router = Router();
  router.post("/tick", async (req, res, next) => {
    try {
      const secret = req.header("x-companion-worker-secret") ?? req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (!config.companionWorkerSecret || secret !== config.companionWorkerSecret) {
        return res.status(401).json({ error: "Invalid worker secret", code: "unauthorized" });
      }
      if (!config.avaFeatureEnabled) return res.json({ scheduled: 0, claimed: 0, completed: 0 });

      const scheduled = await scheduleEligibleProactiveJobs();
      const workerToken = newWorkerToken();
      const jobs = await claimAvaJobs(workerToken);
      let completed = 0;

      for (const job of jobs) {
        try {
          const context = await getAvaJobContext(job);
          const proactive = job.job_type === "proactive";
          const instructions = buildAvaInstructions({
            relationship: relationshipStage(context.user.relationship_started_at, context.user.reply_count),
            activity: context.daily.activity,
            moodNote: context.daily.mood_note,
            memories: context.memories.map((memory) => memory.content),
            proactive
          });
          const messages = proactive
            ? [{ role: "user" as const, content: "請依照今天的生活背景，自然主動傳一則訊息。" }]
            : buildAvaInput(context.messages);
          const content = await generateAvaReply({ userId: job.user_id, instructions, messages });
          await completeAvaJob(job.id, workerToken, content);
          completed += 1;

          if (!proactive) {
            const latestUser = [...context.messages].reverse().find((message) => message.role === "user");
            const memory = latestUser ? extractSafeAvaMemory(latestUser.content) : null;
            if (memory) {
              await saveAvaMemoryIfNew(job.user_id, memory, latestUser?.id).catch((error) => {
                console.warn("[ava:memory]", { message: error instanceof Error ? error.message : "memory_failed" });
              });
            }
          }

          const tokens = await getPushTokens(job.user_id).catch(() => []);
          await sendAvaPush(tokens, content).catch((error) => {
            console.warn("[ava:push]", { message: error instanceof Error ? error.message : "push_failed" });
          });
        } catch (error) {
          await retryAvaJob(job.id, workerToken, error instanceof Error ? error.message : "worker_failed");
        }
      }

      return res.json({ scheduled, claimed: jobs.length, completed });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
