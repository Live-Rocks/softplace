import { Router } from "express";
import { config } from "../config.js";
import { buildAvaInput, buildAvaInstructions, extractSafeAvaMemory, getAvaLifeContext, relationshipStage } from "../domain/ava.js";
import { eventBackgroundFallback } from "../domain/avaEvents.js";
import {
  claimAvaDailyEventDetail,
  claimAvaJobs,
  completeAvaDailyEventDetail,
  completeAvaJob,
  getAvaJobContext,
  getPushTokens,
  newWorkerToken,
  releaseAvaDailyEventDetail,
  retryAvaJob,
  saveAvaMemoryIfNew,
  ensureAvaDailyState,
  scheduleEligibleProactiveJobs
} from "../integrations/avaRepository.js";
import { sendAvaPush } from "../integrations/expoPush.js";
import { generateAvaEventDetail, generateAvaReply } from "../integrations/openai.js";

export function companionWorkerRouter() {
  const router = Router();
  router.post("/tick", async (req, res, next) => {
    try {
      const secret = req.header("x-companion-worker-secret") ?? req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (!config.companionWorkerSecret || secret !== config.companionWorkerSecret) {
        return res.status(401).json({ error: "Invalid worker secret", code: "unauthorized" });
      }
      if (!config.avaFeatureEnabled) return res.json({ scheduled: 0, claimed: 0, completed: 0 });

      await ensureAvaDailyState();
      const scheduled = await scheduleEligibleProactiveJobs();
      const workerToken = newWorkerToken();
      const jobs = await claimAvaJobs(workerToken);
      let completed = 0;

      for (const job of jobs) {
        try {
          const context = await getAvaJobContext(job);
          const proactive = job.job_type === "proactive";
          const currentLife = getAvaLifeContext();
          const latestUser = proactive ? undefined : [...context.messages].reverse().find((message) => message.role === "user");
          const receivedLife = latestUser ? getAvaLifeContext(new Date(latestUser.createdAt)) : undefined;
          const instructions = buildAvaInstructions({
            relationship: relationshipStage(context.user.relationship_started_at, context.user.reply_count),
            activity: context.daily.activity,
            moodNote: context.daily.mood_note,
            receivedActivity: receivedLife?.currentActivity,
            currentActivity: currentLife.currentActivity,
            currentTone: currentLife.tone,
            eventBackground: context.daily.event_detail ?? eventBackgroundFallback({
              activity: context.daily.skeleton_activity ?? context.daily.activity,
              moodNote: context.daily.skeleton_mood_note ?? context.daily.mood_note
            }),
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

      const detailTask = await claimAvaDailyEventDetail();
      if (detailTask) {
        try {
          const detail = await generateAvaEventDetail({
            activity: detailTask.daily.skeleton_activity!,
            moodNote: detailTask.daily.skeleton_mood_note!,
            prompt: detailTask.prompt
          });
          await completeAvaDailyEventDetail(detailTask, detail);
        } catch (error) {
          await releaseAvaDailyEventDetail(detailTask).catch(() => undefined);
          console.warn("[ava:event-detail]", { message: error instanceof Error ? error.message : "event_detail_failed" });
        }
      }

      return res.json({ scheduled, claimed: jobs.length, completed });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
