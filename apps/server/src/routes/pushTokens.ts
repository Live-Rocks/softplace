import { Router } from "express";
import { z } from "zod";
import { deletePushToken, upsertPushToken } from "../integrations/avaRepository.js";

const tokenSchema = z.object({
  token: z.string()
    .max(500)
    .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/, "Invalid Expo push token"),
  platform: z.enum(["android", "ios"])
});

export function pushTokensRouter() {
  const router = Router();
  router.post("/", async (req, res, next) => {
    try {
      const body = tokenSchema.parse(req.body);
      await upsertPushToken(req.user.id, body.token, body.platform);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });
  router.delete("/", async (req, res, next) => {
    try {
      const body = tokenSchema.pick({ token: true }).parse(req.body);
      await deletePushToken(req.user.id, body.token);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
