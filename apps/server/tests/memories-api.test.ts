import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createMemoryRepository } from "../src/integrations/repository.js";
import { memoriesRouter } from "../src/routes/memories.js";

const testUser = {
  id: "00000000-0000-4000-8000-000000000003",
  email: "memories@softplace.local",
  plan: "plus" as const
};

async function withTestServer(
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
  app.use("/api/memories", memoriesRouter(repository));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    await run(`http://127.0.0.1:${port}/api/memories`, repository);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("manual memories allow user-confirmed sensitive wording", async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "我的電話是 0912345678，email 是 me@example.com；我曾被說有焦慮症。",
        category: "emotional_context"
      })
    });

    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      memory: { content: string; category: string };
    };
    assert.equal(body.memory.category, "emotional_context");
    assert.match(body.memory.content, /0912345678/);
    assert.match(body.memory.content, /焦慮症/);
  });
});

test("manual memories reject blank and overly long content with readable errors", async () => {
  await withTestServer(async (baseUrl) => {
    const blank = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "   ", category: "preference" })
    });
    assert.equal(blank.status, 422);
    assert.match(((await blank.json()) as { error: string }).error, /不能是空白/);

    const tooLong = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "記".repeat(301), category: "preference" })
    });
    assert.equal(tooLong.status, 400);
    assert.match(((await tooLong.json()) as { error: string }).error, /最多 300 字/);
  });
});

test("manual memory updates use the same relaxed validation", async () => {
  await withTestServer(async (baseUrl) => {
    const created = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "我喜歡自然一點的語氣。", category: "preference" })
    });
    const createdBody = (await created.json()) as { memory: { id: string } };

    const updated = await fetch(`${baseUrl}/${createdBody.memory.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "我焦慮症相關的事可以自己手動記下來，不要被系統擋掉。",
        category: "emotional_context"
      })
    });

    assert.equal(updated.status, 200);
    const updatedBody = (await updated.json()) as {
      memory: { content: string; category: string };
    };
    assert.equal(updatedBody.memory.category, "emotional_context");
    assert.match(updatedBody.memory.content, /焦慮症/);
  });
});
