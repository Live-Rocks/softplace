import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { config } from "../src/config.js";
import {
  CompanionProviderError,
  CompanionProviderTimeoutError,
  type GenerateCompanionReplyInput
} from "../src/integrations/openai.js";
import { createMemoryRepository } from "../src/integrations/repository.js";
import { chatRouter } from "../src/routes/chat.js";
import type { Repository } from "../src/types.js";

const testUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "tester@softplace.local",
  plan: "plus" as const
};

async function withTestServer(
  generateReply: (input: GenerateCompanionReplyInput) => Promise<{ content: string; provider: "openai" | "local" }>,
  run: (baseUrl: string, repository: ReturnType<typeof createMemoryRepository>) => Promise<void>,
  repository: Repository = createMemoryRepository([testUser])
) {
  await repository.getOrCreateProfile(testUser);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = testUser;
    next();
  });
  app.use("/api/chat", chatRouter(repository, generateReply));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "test error", code: "internal_error" });
  });
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

async function consumeDeepQuota(repository: Repository, count: number) {
  const conversation = await repository.getOrCreatePrimaryConversation(testUser.id);
  for (let index = 0; index < count; index += 1) {
    const reservation = await repository.reserveDeepUsage(testUser.id, testUser.plan, 120);
    assert.equal(reservation.reserved, true);
    assert.ok(reservation.reservationId);
    await repository.completeChatSuccess(testUser.id, testUser.plan, {
      conversationId: conversation.id,
      userContent: `quota-user-${index}`,
      userImagePresent: false,
      assistantContent: `quota-assistant-${index}`,
      modelUsed: config.openAiDeepModel,
      mode: "deep",
      reservationId: reservation.reservationId
    });
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
      assert.deepEqual(
        captured?.history.map((message) => message.sequence),
        [...(captured?.history.map((message) => message.sequence) ?? [])].sort((a, b) => a - b)
      );
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
      await consumeDeepQuota(repository, 300);
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
      await consumeDeepQuota(repository, 300);
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

test("provider timeouts return 504 and release the deep reservation", async () => {
  await withTestServer(
    async () => {
      throw new CompanionProviderTimeoutError(new Error("request timed out"));
    },
    async (baseUrl, repository) => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "可以慢慢陪我嗎", requestedMode: "deep" })
      });
      assert.equal(response.status, 504);
      const body = (await response.json()) as { code?: string; error?: string };
      assert.equal(body.code, "provider_timeout");
      assert.match(body.error ?? "", /沒有扣除額度/);
      assert.equal((await repository.getUsage(testUser.id, testUser.plan)).deepMessagesUsed, 0);

      const replacement = await repository.reserveDeepUsage(testUser.id, testUser.plan, 120);
      assert.equal(replacement.reserved, true);
    }
  );
});

test("completion failures save no partial messages and release the reservation", async () => {
  const baseRepository = createMemoryRepository([testUser]);
  let releaseCalls = 0;
  const failingRepository: Repository = {
    ...baseRepository,
    async completeChatSuccess() {
      throw new Error("completion failed");
    },
    async releaseDeepUsage(userId, reservationId) {
      releaseCalls += 1;
      return baseRepository.releaseDeepUsage(userId, reservationId);
    }
  };

  await withTestServer(
    async () => ({ content: "我陪你待一下。", provider: "openai" }),
    async (baseUrl, repository) => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "今天有點難受", requestedMode: "deep" })
      });
      assert.equal(response.status, 500);
      assert.equal(releaseCalls, 1);
      assert.equal((await repository.getUsage(testUser.id, testUser.plan)).deepMessagesUsed, 0);
      const conversation = await repository.getOrCreatePrimaryConversation(testUser.id);
      assert.equal((await repository.listMessages(testUser.id, conversation.id, { limit: 10 })).length, 0);
    },
    failingRepository
  );
});

test("the thirteenth non-crisis request is rate limited before OpenAI", async () => {
  let generatorCalls = 0;
  await withTestServer(
    async () => {
      generatorCalls += 1;
      return { content: "我有收到。", provider: "openai" };
    },
    async (baseUrl) => {
      for (let index = 0; index < 12; index += 1) {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: `一般訊息 ${index}`, requestedMode: "light" })
        });
        assert.equal(response.status, 200);
      }

      const limited = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "第十三則", requestedMode: "light" })
      });
      assert.equal(limited.status, 429);
      assert.equal((await limited.json() as { code?: string }).code, "rate_limited");
      assert.ok(Number(limited.headers.get("retry-after")) >= 1);
      assert.equal(generatorCalls, 12);
    }
  );
});

test("crisis responses bypass the ordinary chat rate limit", async () => {
  let generatorCalls = 0;
  await withTestServer(
    async () => {
      generatorCalls += 1;
      return { content: "一般回覆", provider: "openai" };
    },
    async (baseUrl, repository) => {
      for (let index = 0; index < 12; index += 1) {
        const consumed = await repository.consumeChatRateLimit(testUser.id, {
          perMinute: 12,
          perHour: 120
        });
        assert.equal(consumed.allowed, true);
      }

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "我想自殺", requestedMode: "deep" })
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { crisisDetected?: boolean; provider?: string };
      assert.equal(body.crisisDetected, true);
      assert.equal(body.provider, "local");
      assert.equal(generatorCalls, 0);
      const conversation = await repository.getOrCreatePrimaryConversation(testUser.id);
      const messages = await repository.listMessages(testUser.id, conversation.id, { limit: 10 });
      assert.equal(messages.length, 2);
      assert.equal(messages[0]?.role, "user");
      assert.equal(messages[1]?.role, "assistant");
      assert.ok((messages[0]?.sequence ?? 0) < (messages[1]?.sequence ?? 0));
    }
  );
});

test("concurrent reservations cannot exceed the remaining deep quota", async () => {
  const repository = createMemoryRepository([testUser]);
  await consumeDeepQuota(repository, 299);

  const [first, second] = await Promise.all([
    repository.reserveDeepUsage(testUser.id, testUser.plan, 120),
    repository.reserveDeepUsage(testUser.id, testUser.plan, 120)
  ]);
  assert.equal([first.reserved, second.reserved].filter(Boolean).length, 1);
});

test("finalizing the same reservation twice never charges twice", async () => {
  const repository = createMemoryRepository([testUser]);
  const conversation = await repository.getOrCreatePrimaryConversation(testUser.id);
  const reservation = await repository.reserveDeepUsage(testUser.id, testUser.plan, 120);
  assert.ok(reservation.reservationId);
  const input = {
    conversationId: conversation.id,
    userContent: "今天有點累",
    userImagePresent: false,
    assistantContent: "我陪你停一下。",
    modelUsed: config.openAiDeepModel,
    mode: "deep" as const,
    reservationId: reservation.reservationId
  };

  await repository.completeChatSuccess(testUser.id, testUser.plan, input);
  await assert.rejects(repository.completeChatSuccess(testUser.id, testUser.plan, input), /reservation_not_active/);
  assert.equal((await repository.getUsage(testUser.id, testUser.plan)).deepMessagesUsed, 1);
  const messages = await repository.listMessages(testUser.id, conversation.id, { limit: 10 });
  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
  assert.ok((messages[0]?.sequence ?? 0) < (messages[1]?.sequence ?? 0));
});

test("hourly rate limits are isolated by user", async () => {
  const repository = createMemoryRepository([testUser]);
  for (let index = 0; index < 120; index += 1) {
    const result = await repository.consumeChatRateLimit(testUser.id, { perMinute: 1000, perHour: 120 });
    assert.equal(result.allowed, true);
  }
  assert.equal(
    (await repository.consumeChatRateLimit(testUser.id, { perMinute: 1000, perHour: 120 })).allowed,
    false
  );
  assert.equal(
    (
      await repository.consumeChatRateLimit("00000000-0000-4000-8000-000000000002", {
        perMinute: 1000,
        perHour: 120
      })
    ).allowed,
    true
  );
});

test("new repository profiles default to free without changing existing plans", async () => {
  const repository = createMemoryRepository([testUser]);
  assert.equal((await repository.getOrCreateProfile(testUser)).plan, "plus");
  assert.equal(
    (
      await repository.getOrCreateProfile({
        id: "00000000-0000-4000-8000-000000000003",
        email: "new@softplace.local"
      })
    ).plan,
    "free"
  );
});
