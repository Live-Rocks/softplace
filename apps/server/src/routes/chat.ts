import { Router } from "express";
import { z } from "zod";
import type { ChatResponse } from "@softplace/shared";
import { config } from "../config.js";
import { buildCompanionInstructions } from "../domain/companionPrompt.js";
import { suggestMemoriesFromUserText } from "../domain/memory.js";
import { assessCrisis, buildCrisisResponse } from "../domain/safety.js";
import { decideCompanionMode } from "../domain/usage.js";
import {
  CompanionProviderError,
  generateCompanionReply,
  type GenerateCompanionReplyInput,
  type GeneratedCompanionReply
} from "../integrations/openai.js";
import type { Repository } from "../types.js";

const chatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  requestedMode: z.enum(["light", "deep"]).default("light"),
  entryIntent: z.string().trim().max(80).optional(),
  imageBase64: z.string().max(7_500_000).optional(),
  imageMimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional()
});

type ReplyGenerator = (input: GenerateCompanionReplyInput) => Promise<GeneratedCompanionReply>;

export function chatRouter(repository: Repository, generateReply: ReplyGenerator = generateCompanionReply) {
  const router = Router();

  router.post("/", async (req, res, next) => {
    try {
      const body = chatSchema.parse(req.body);
      const hasImage = Boolean(body.imageBase64);
      const user = req.user;
      const usage = await repository.getUsage(user.id, user.plan);
      const crisis = assessCrisis(body.message);

      const conversation = await repository.getOrCreatePrimaryConversation(user.id);

      if (crisis.crisisDetected) {
        await repository.createMessage({
          conversationId: conversation.id,
          role: "user",
          content: body.message,
          imagePresent: hasImage,
          crisisDetected: true
        });
        const assistantMessage = await repository.createMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: buildCrisisResponse(body.message),
          modelUsed: "crisis-mode",
          mode: "light",
          crisisDetected: true
        });
        await repository.touchConversation(user.id, conversation.id);
        const response: ChatResponse = {
          conversationId: conversation.id,
          assistantMessage,
          usage,
          mode: "light",
          modelUsed: "crisis-mode",
          provider: "local",
          crisisDetected: true,
          memorySuggestions: [],
          imageAccepted: false
        };
        return res.json(response);
      }

      const decision = decideCompanionMode(usage, hasImage, body.requestedMode);
      if (!decision.ok) {
        return res.status(402).json({ error: decision.message, code: decision.code });
      }

      const modelUsed = decision.mode === "deep" ? config.openAiDeepModel : config.openAiLightModel;
      const [memories, history] = await Promise.all([
        repository.listMemories(user.id),
        repository.listMessages(user.id, conversation.id, { limit: 20 })
      ]);

      let generated: GeneratedCompanionReply;
      try {
        generated = await generateReply({
          userId: user.id,
          model: modelUsed,
          mode: decision.mode,
          instructions: buildCompanionInstructions(memories, {
            mode: decision.mode,
            hasImage
          }),
          history,
          userMessage: body.message,
          imageBase64: body.imageBase64,
          imageMimeType: body.imageMimeType
        });
      } catch (error) {
        if (error instanceof CompanionProviderError) {
          return res.status(502).json({ error: error.message, code: "provider_unavailable" });
        }
        throw error;
      }

      await repository.createMessage({
        conversationId: conversation.id,
        role: "user",
        content: body.message,
        imagePresent: hasImage,
        crisisDetected: false
      });

      const assistantMessage = await repository.createMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: generated.content,
        modelUsed,
        mode: decision.mode,
        imagePresent: false,
        crisisDetected: false
      });

      const updatedUsage = await repository.incrementUsage(user.id, {
        deep: decision.chargeDeep ? 1 : 0
      });
      await repository.touchConversation(user.id, conversation.id);

      const response: ChatResponse = {
        conversationId: conversation.id,
        assistantMessage,
        usage: updatedUsage,
        mode: decision.mode,
        modelUsed,
        provider: generated.provider,
        crisisDetected: false,
        memorySuggestions: suggestMemoriesFromUserText(body.message),
        imageAccepted: hasImage,
        quotaNotice: decision.quotaNotice
      };

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
