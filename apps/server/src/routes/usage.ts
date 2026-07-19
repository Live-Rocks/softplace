import { Router } from "express";
import { config } from "../config.js";
import type { Repository } from "../types.js";

export function usageRouter(repository: Repository) {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      res.json({
        usage: await repository.getUsage(req.user.id, req.user.plan),
        provider: config.aiProvider,
        models: {
          deep: config.openAiDeepModel,
          light: config.openAiLightModel
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
