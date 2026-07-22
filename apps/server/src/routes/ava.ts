import { Router } from "express";
import { z } from "zod";
import { calculateReplyDueAt, getAvaLifeContext } from "../domain/ava.js";
import { assessCrisis, buildCrisisResponse } from "../domain/safety.js";
import {
  deleteAvaMemory,
  deleteAvaRelationship,
  enqueueAvaMessage,
  ensureAvaUser,
  getAvaState,
  isAvaEnabledFor,
  listAvaMemories,
  listAvaMessages,
  markAvaRead,
  saveImmediateAvaExchange,
  updateAvaMemory,
  updateAvaPreferences
} from "../integrations/avaRepository.js";

const messageSchema = z.object({ content: z.string().trim().min(1).max(4000) });
const preferencesSchema = z.object({
  proactiveLevel: z.enum(["off", "low", "normal"]).optional(),
  quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  timezone: z.string().min(1).max(80).optional()
});

export function avaRouter() {
  const router = Router();

  router.use((req, res, next) => {
    if (!isAvaEnabledFor(req.user.id)) {
      return res.status(404).json({ error: "Ava 尚未對這個帳號開放。", code: "feature_unavailable" });
    }
    return next();
  });

  router.get("/", async (req, res, next) => {
    try {
      return res.json({ state: await getAvaState(req.user.id) });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/messages", async (req, res, next) => {
    try {
      const query = z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
      const [timeline, state] = await Promise.all([
        listAvaMessages(req.user.id, query.limit, query.before),
        getAvaState(req.user.id)
      ]);
      return res.json({ ...timeline, state });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/messages", async (req, res, next) => {
    try {
      const { content } = messageSchema.parse(req.body);
      const crisis = assessCrisis(content);
      if (crisis.crisisDetected) {
        const messages = await saveImmediateAvaExchange(req.user.id, content, buildCrisisResponse(content));
        return res.status(201).json({
          message: messages.find((message) => message.role === "user"),
          assistantMessage: messages.find((message) => message.role === "assistant"),
          state: await getAvaState(req.user.id),
          crisisDetected: true
        });
      }

      const user = await ensureAvaUser(req.user.id);
      const state = await getAvaState(req.user.id);
      if (state.dailyUsed >= state.dailyLimit) {
        return res.status(429).json({ error: "Ava 今天能回覆的訊息已經用完了，明天會再恢復。", code: "ava_daily_limit" });
      }
      const now = new Date();
      const dueAt = calculateReplyDueAt({ lifeContext: getAvaLifeContext(now), lastAssistantAt: user.last_assistant_message_at, now });
      const message = await enqueueAvaMessage(req.user.id, content, dueAt);
      return res.status(202).json({ message, state: await getAvaState(req.user.id), crisisDetected: false });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/preferences", async (req, res, next) => {
    try {
      const preferences = preferencesSchema.parse(req.body);
      return res.json({ state: await updateAvaPreferences(req.user.id, preferences) });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/read", async (req, res, next) => {
    try {
      await markAvaRead(req.user.id);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  router.get("/memories", async (req, res, next) => {
    try {
      return res.json({ memories: await listAvaMemories(req.user.id) });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/memories/:id", async (req, res, next) => {
    try {
      const body = z.object({ content: z.string().trim().min(1).max(300) }).parse(req.body);
      return res.json({ memory: await updateAvaMemory(req.user.id, req.params.id, body.content) });
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/memories/:id", async (req, res, next) => {
    try {
      await deleteAvaMemory(req.user.id, req.params.id);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/relationship", async (req, res, next) => {
    try {
      await deleteAvaRelationship(req.user.id);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
