import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createMemoryRepository } from "../src/integrations/repository.js";
import { conversationsRouter } from "../src/routes/conversations.js";

const testUser = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "history@softplace.local",
  plan: "plus" as const
};

test("conversation history paginates without gaps and clearing starts a new timeline", async () => {
  const repository = createMemoryRepository();
  await repository.getOrCreateProfile(testUser);
  const originalConversation = await repository.getOrCreatePrimaryConversation(testUser.id);
  for (let index = 0; index < 120; index += 1) {
    await repository.createMessage({
      conversationId: originalConversation.id,
      role: index % 2 ? "assistant" : "user",
      content: `message-${index}`
    });
  }

  const app = express();
  app.use((req, _res, next) => {
    req.user = testUser;
    next();
  });
  app.use("/api/conversations", conversationsRouter(repository));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/api/conversations`;

  try {
    const allIds = new Set<string>();
    let cursor: string | null = null;
    const pageSizes: number[] = [];
    do {
      const query = cursor ? `?limit=50&before=${encodeURIComponent(cursor)}` : "?limit=50";
      const response = await fetch(`${baseUrl}/current/messages${query}`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        messages: Array<{ id: string; sequence: number }>;
        nextCursor: string | null;
      };
      pageSizes.push(body.messages.length);
      assert.deepEqual(
        body.messages.map((message) => message.sequence),
        [...body.messages.map((message) => message.sequence)].sort((a, b) => a - b)
      );
      body.messages.forEach((message) => allIds.add(message.id));
      cursor = body.nextCursor;
    } while (cursor);

    assert.deepEqual(pageSizes, [50, 50, 20]);
    assert.equal(allIds.size, 120);

    const cleared = await fetch(`${baseUrl}/current`, { method: "DELETE" });
    assert.equal(cleared.status, 204);
    const afterClear = await fetch(`${baseUrl}/current/messages?limit=50`);
    const afterClearBody = (await afterClear.json()) as {
      conversation: { id: string };
      messages: unknown[];
    };
    assert.notEqual(afterClearBody.conversation.id, originalConversation.id);
    assert.equal(afterClearBody.messages.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
