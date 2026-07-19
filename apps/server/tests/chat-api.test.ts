import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { config } from "../src/config.js";
import { CompanionProviderError, type GenerateCompanionReplyInput } from "../src/integrations/openai.js";
import { createMemoryRepository } from "../src/integrations/repository.js";
import { chatRouter } from "../src/routes/chat.js";

const testUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "tester@softplace.local",
  plan: "plus" as const
};

async function withTestServer(
  generateReply: (input: GenerateCompanionReplyInput) => Promise<{ content: string; provider: "openai" | "local" }>,
  run: (baseUrl: string, repository: ReturnType<typeof createMemoryRepository>) => Promise<void>
) {
  const repository = createMemoryRepository();
  await repository.getOrCreateProfile(testUser);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = testUser;
    next();
  });
  app.use("/api/chat", chatRouter(repository, generateReply));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`, repository);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("chat sends only the previous 20 messages and charges successful deep replies", async () => {
  let captured: GenerateCompanionReplyInput | null = null;
  await withTestServer(
    async (input) => {
      captured = input;
      return { content: "我在這裡。", provider: "openai" };
    },
    async (baseUrl, repository) => {
      const conversation = await repository.getOrCreatePrimaryConversation(testUser.id);
      for (let index = 0; index < 22; index += 1) {
        await repository.createMessage({
          conversationId: conversation.id,
          role: index % 2 ? "assistant" : "user",
          content: `history-${index}`
        });
      }

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "剛剛那件事", requestedMode: "deep" })
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        mode: string;
        provider: string;
        usage: { deepMessagesUsed: number };
      };
      assert.equal(body.mode, "deep");
      assert.equal(body.provider, "openai");
      assert.equal(body.usage.deepMessagesUsed, 1);
      assert.equal(captured?.history.length, 20);
      assert.equal(captured?.history.some((message) => message.content === "剛剛那件事"), false);
      assert.equal(captured?.mode, "deep");
      assert.equal(captured?.model, config.openAiDeepModel);
      assert.match(captured?.instructions ?? "", /【本輪模式：深度模式】/);
      assert.doesNotMatch(captured?.instructions ?? "", /【本輪模式：輕量模式】/);
    }
  );
});

test("light requests use the light model and only light prompt guidance", async () => {
  let captured: GenerateCompanionReplyInput | null = null;
  await withTestServer(
    async (input) => {
      captured = input;
      return { content: "今天的風好像很舒服。", provider: "openai" };
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "我今天去散步", requestedMode: "light" })
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as { mode: string; modelUsed: string };
      assert.equal(body.mode, "light");
      assert.equal(body.modelUsed, config.openAiLightModel);
      assert.equal(captured?.mode, "light");
      assert.equal(captured?.model, config.openAiLightModel);
      assert.match(captured?.instructions ?? "", /【本輪模式：輕量模式】/);
      assert.doesNotMatch(captured?.instructions ?? "", /【本輪模式：深度模式】/);
    }
  );
});

test("images force the deep model and deep prompt even when light mode was requested", async () => {
  let captured: GenerateCompanionReplyInput | null = null;
  await withTestServer(
    async (input) => {
      captured = input;
      return { content: "我有看到這張圖片。", provider: "openai" };
    },
    async (baseUrl, repository) => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "猜猜我去哪裡",
          requestedMode: "light",
          imageBase64: "ZmFrZQ==",
          imageMimeType: "image/jpeg"
        })
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        mode: string;
        modelUsed: string;
        usage: { deepMessagesUsed: number } & Record<string, unknown>;
      };
      assert.equal(body.mode, "deep");
      assert.equal(body.modelUsed, config.openAiDeepModel);
      assert.equal(body.usage.deepMessagesUsed, 1);
      assert.equal("imageMessagesUsed" in body.usage, false);
      assert.equal("imageMessagesLimit" in body.usage, false);
      assert.equal(captured?.mode, "deep");
      assert.match(captured?.instructions ?? "", /【本輪模式：深度模式】/);
      assert.match(captured?.instructions ?? "", /這次附有圖片/);

      const conversation = await repository.getOrCreatePrimaryConversation(testUser.id);
      const messages = await repository.listMessages(testUser.id, conversation.id, { limit: 10 });
      const userMessage = messages.find((message) => message.role === "user");
      assert.equal(userMessage?.imagePresent, true);
    }
  );
});

test("images are rejected when the shared deep quota is exhausted", async () => {
  let generatorCalled = false;
  await withTestServer(
    async () => {
      generatorCalled = true;
      return { content: "不應該產生這則回覆。", provider: "openai" };
    },
    async (baseUrl, repository) => {
      await repository.incrementUsage(testUser.id, { deep: 300 });
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "我想給你看這張圖",
          requestedMode: "light",
          imageBase64: "ZmFrZQ==",
          imageMimeType: "image/jpeg"
        })
      });

      assert.equal(response.status, 402);
      const body = (await response.json()) as { code?: string };
      assert.equal(body.code, "image_requires_deep_quota");
      assert.equal(generatorCalled, false);
    }
  );
});

test("exhausted deep quota falls back to both the light model and light prompt", async () => {
  let captured: GenerateCompanionReplyInput | null = null;
  await withTestServer(
    async (input) => {
      captured = input;
      return { content: "我先留在這裡陪你。", provider: "openai" };
    },
    async (baseUrl, repository) => {
      await repository.incrementUsage(testUser.id, { deep: 300 });
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "今天有點累", requestedMode: "deep" })
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        mode: string;
        modelUsed: string;
        quotaNotice?: string;
        usage: { deepMessagesUsed: number };
      };
      assert.equal(body.mode, "light");
      assert.equal(body.modelUsed, config.openAiLightModel);
      assert.match(body.quotaNotice ?? "", /輕量陪伴/);
      assert.equal(body.usage.deepMessagesUsed, 300);
      assert.equal(captured?.mode, "light");
      assert.match(captured?.instructions ?? "", /【本輪模式：輕量模式】/);
      assert.doesNotMatch(captured?.instructions ?? "", /【本輪模式：深度模式】/);
    }
  );
});

test("provider failures return 502 and do not consume deep quota", async () => {
  await withTestServer(
    async () => {
      throw new CompanionProviderError(new Error("upstream failed"));
    },
    async (baseUrl, repository) => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "今天有點難受", requestedMode: "deep" })
      });
      assert.equal(response.status, 502);
      const usage = await repository.getUsage(testUser.id, testUser.plan);
      assert.equal(usage.deepMessagesUsed, 0);

      const conversation = await repository.getOrCreatePrimaryConversation(testUser.id);
      const messages = await repository.listMessages(testUser.id, conversation.id, { limit: 10 });
      assert.equal(messages.length, 0);
    }
  );
});
