import { Router } from "express";
import { z } from "zod";
import type { Repository } from "../types.js";

export function conversationsRouter(repository: Repository) {
  const router = Router();

  router.get("/current/messages", async (req, res, next) => {
    try {
      const query = z
        .object({
          before: z.string().max(500).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50)
        })
        .parse(req.query);
      const conversation = await repository.getOrCreatePrimaryConversation(req.user.id);
      const fetched = await repository.listMessages(req.user.id, conversation.id, {
        before: query.before ? decodeCursor(query.before) : undefined,
        limit: query.limit + 1
      });
      const hasMore = fetched.length > query.limit;
      const messages = hasMore ? fetched.slice(1) : fetched;
      const nextCursor = hasMore && messages[0] ? encodeCursor(messages[0]) : null;
      return res.json({ conversation, messages, nextCursor });
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/current", async (req, res, next) => {
    try {
      const conversations = await repository.listConversations(req.user.id);
      await Promise.all(conversations.map((conversation) => repository.deleteConversation(req.user.id, conversation.id)));
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      return res.json({ conversations: await repository.listConversations(req.user.id) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function encodeCursor(message: { createdAt: string; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: message.createdAt, id: message.id })).toString("base64url");
}

function decodeCursor(cursor: string) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return z.object({ createdAt: z.string().datetime(), id: z.string().uuid() }).parse(parsed);
  } catch {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["before"],
        message: "Invalid pagination cursor"
      }
    ]);
  }
}
