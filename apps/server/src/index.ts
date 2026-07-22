import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { assertRuntimeConfig, config } from "./config.js";
import { createRepository } from "./integrations/repository.js";
import { requireAuth } from "./middleware/auth.js";
import { chatRouter } from "./routes/chat.js";
import { conversationsRouter } from "./routes/conversations.js";
import { memoriesRouter } from "./routes/memories.js";
import { usageRouter } from "./routes/usage.js";
import { avaRouter } from "./routes/ava.js";
import { companionWorkerRouter } from "./routes/companionWorker.js";
import { pushTokensRouter } from "./routes/pushTokens.js";

assertRuntimeConfig();

const app = express();
const repository = createRepository();

app.use(cors({ origin: config.appOrigin === "*" ? true : config.appOrigin }));
app.use(express.json({ limit: "8mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "softplace-server" });
});

app.use("/internal/companion", companionWorkerRouter());

app.use("/api", requireAuth(repository));
app.use("/api/chat", chatRouter(repository));
app.use("/api/conversations", conversationsRouter(repository));
app.use("/api/memories", memoriesRouter(repository));
app.use("/api/me/usage", usageRouter(repository));
app.use("/api/companions/ava", avaRouter());
app.use("/api/push-tokens", pushTokensRouter());

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: "Invalid request", code: "bad_request", details: error.flatten() });
  }

  console.error("[softplace:error]", {
    name: error?.name,
    message: error?.message,
    code: error?.code
  });
  return res.status(500).json({ error: "Something went wrong", code: "internal_error" });
};

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`SoftPlace server listening on http://localhost:${config.port}`);
});
