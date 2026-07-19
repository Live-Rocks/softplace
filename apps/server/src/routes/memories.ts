import { Router } from "express";
import { z } from "zod";
import {
  manualMemoryMaxLength,
  normalizeMemoryCategory,
  sanitizeMemoryContent,
  validateManualMemoryContent
} from "../domain/memory.js";
import type { Repository } from "../types.js";

const memorySchema = z.object({
  content: z.string().max(manualMemoryMaxLength),
  category: z.enum(["preference", "emotional_context"])
});

export function memoriesRouter(repository: Repository) {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      res.json({ memories: await repository.listMemories(req.user.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const parsed = memorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: `記憶內容最多 ${manualMemoryMaxLength} 字。`, code: "bad_request" });
      }
      const body = parsed.data;
      const validationError = validateManualMemoryContent(body.content);
      if (validationError) {
        return res.status(422).json({ error: validationError, code: "memory_invalid" });
      }
      const content = sanitizeMemoryContent(body.content);
      const memory = await repository.createMemory({
        userId: req.user.id,
        content,
        category: normalizeMemoryCategory(body.category)
      });
      return res.status(201).json({ memory });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const parsed = memorySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: `記憶內容最多 ${manualMemoryMaxLength} 字。`, code: "bad_request" });
      }
      const body = parsed.data;
      const content =
        body.content === undefined ? undefined : sanitizeMemoryContent(body.content);
      if (body.content !== undefined) {
        const validationError = validateManualMemoryContent(body.content);
        if (validationError) {
          return res.status(422).json({ error: validationError, code: "memory_invalid" });
        }
      }
      const memory = await repository.updateMemory(req.user.id, req.params.id, {
        content,
        category: body.category ? normalizeMemoryCategory(body.category) : undefined
      });
      return res.json({ memory });
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      await repository.deleteMemory(req.user.id, req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
