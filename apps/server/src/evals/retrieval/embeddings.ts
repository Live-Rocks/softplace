import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type OpenAI from "openai";
import type { EmbeddingModelSpec, EmbeddingProvider } from "./types.js";

type OpenAIEmbeddingClient = Pick<OpenAI, "embeddings">;

export function createOpenAIEmbeddingProvider(client: OpenAIEmbeddingClient): EmbeddingProvider {
  return {
    async embed(input) {
      const response = await client.embeddings.create({
        model: input.model,
        input: input.texts,
        dimensions: input.dimensions,
        encoding_format: "float"
      });
      const ordered = [...response.data].sort((left, right) => left.index - right.index);
      if (ordered.length !== input.texts.length) throw new Error("embedding_response_count_mismatch");
      return ordered.map((item) => item.embedding);
    }
  };
}

export function createEmbeddingCacheKey(spec: EmbeddingModelSpec, text: string) {
  return crypto
    .createHash("sha256")
    .update(`${spec.model}\u0000${spec.dimensions}\u0000${text}`)
    .digest("hex");
}

export async function embedTextsWithCache(input: {
  provider: EmbeddingProvider;
  spec: EmbeddingModelSpec;
  texts: string[];
  cacheDir: string;
  batchSize?: number;
  ignoreCache?: boolean;
}) {
  const texts = [...new Set(input.texts)];
  const batchSize = input.batchSize ?? 64;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("invalid_embedding_batch_size");

  const cachePath = path.join(
    input.cacheDir,
    `${input.spec.model.replace(/[^a-zA-Z0-9._-]/g, "_")}-${input.spec.dimensions}.json`
  );
  const cache = input.ignoreCache ? {} : await readCache(cachePath);
  const results = new Map<string, number[]>();
  const missing: string[] = [];

  for (const text of texts) {
    const cached = cache[createEmbeddingCacheKey(input.spec, text)];
    if (cached) results.set(text, cached);
    else missing.push(text);
  }

  for (let start = 0; start < missing.length; start += batchSize) {
    const batch = missing.slice(start, start + batchSize);
    const vectors = await input.provider.embed({
      model: input.spec.model,
      dimensions: input.spec.dimensions,
      texts: batch
    });
    if (vectors.length !== batch.length) throw new Error("embedding_provider_count_mismatch");
    for (let index = 0; index < batch.length; index += 1) {
      const text = batch[index]!;
      const vector = vectors[index]!;
      if (vector.length !== input.spec.dimensions) {
        throw new Error(`embedding_dimension_mismatch:${vector.length}/${input.spec.dimensions}`);
      }
      results.set(text, vector);
      cache[createEmbeddingCacheKey(input.spec, text)] = vector;
    }
  }

  if (missing.length) {
    await fs.mkdir(input.cacheDir, { recursive: true });
    const tempPath = `${cachePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(cache));
    await fs.rename(tempPath, cachePath);
  }
  return results;
}

async function readCache(cachePath: string): Promise<Record<string, number[]>> {
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, number[]>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
