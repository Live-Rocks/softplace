import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createMemoryRepository } from "../src/integrations/repository.js";
import { requireAuth } from "../src/middleware/auth.js";

test("protected API routes reject requests without a bearer token", async () => {
  const app = express();
  app.use("/api", requireAuth(createMemoryRepository()));
  app.get("/api/private", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/private`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Missing bearer token",
      code: "unauthorized"
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
