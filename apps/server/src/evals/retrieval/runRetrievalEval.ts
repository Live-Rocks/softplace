import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { retrievalEvalDatasetV2 } from "./dataset.v2.js";
import { createOpenAIEmbeddingProvider } from "./embeddings.js";
import { renderRetrievalEvalMarkdown } from "./report.js";
import { runRetrievalModelEval } from "./runner.js";
import { choosePhase0Recommendation } from "./evaluator.js";
import type { ChunkStrategy, EmbeddingModelSpec } from "./types.js";

const defaultDimensions: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072
};

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for retrieval eval. Ordinary tests do not require this key.");
  }

  const client = new OpenAI({ apiKey });
  const provider = createOpenAIEmbeddingProvider(client);
  const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
  const artifactRoot = options.outputDir
    ? path.resolve(options.outputDir)
    : path.join(repoRoot, "artifacts", "retrieval-eval");
  const cacheDir = path.join(artifactRoot, "cache");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(artifactRoot, "reports", runId);

  const reports = [];
  for (const spec of options.models) {
    console.info(`[retrieval-eval] embedding ${spec.model} (${spec.dimensions} dimensions)`);
    reports.push(await runRetrievalModelEval({
      dataset: retrievalEvalDatasetV2,
      provider,
      spec,
      cacheDir,
      topKs: options.topKs,
      thresholds: options.thresholds,
      chunkStrategies: options.chunkStrategies,
      batchSize: options.batchSize,
      ignoreCache: options.ignoreCache
    }));
  }
  const recommendation = choosePhase0Recommendation(reports);

  await fs.mkdir(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, "report.json");
  const markdownPath = path.join(reportDir, "report.md");
  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify({ dataset: {
      version: retrievalEvalDatasetV2.version,
      source: retrievalEvalDatasetV2.source,
      locale: retrievalEvalDatasetV2.locale,
      users: retrievalEvalDatasetV2.users.length,
      cases: retrievalEvalDatasetV2.cases.length
    }, recommendation, reports }, null, 2)}\n`),
    fs.writeFile(markdownPath, renderRetrievalEvalMarkdown(reports, recommendation))
  ]);
  console.info(`[retrieval-eval] JSON: ${jsonPath}`);
  console.info(`[retrieval-eval] Markdown: ${markdownPath}`);
  return { jsonPath, markdownPath, recommendation, reports };
}

export function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (const argument of argv) {
    if (!argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}`);
    const [key, value] = argument.slice(2).split("=", 2);
    if (value === undefined) flags.add(key!);
    else values.set(key!, value);
  }

  if (values.has("specs") && (values.has("models") || values.has("dimensions"))) {
    throw new Error("--specs cannot be combined with --models or --dimensions");
  }
  const modelNames = csv(values.get("models") ?? "text-embedding-3-small,text-embedding-3-large");
  const dimensionOverrides = new Map(
    csv(values.get("dimensions") ?? "").filter(Boolean).map((entry) => {
      const [model, rawDimensions] = entry.split(":");
      const dimensions = Number(rawDimensions);
      if (!model || !Number.isInteger(dimensions) || dimensions < 1) throw new Error(`Invalid dimensions: ${entry}`);
      return [model, dimensions] as const;
    })
  );
  const legacyModels: EmbeddingModelSpec[] = modelNames.map((model) => {
    const dimensions = dimensionOverrides.get(model) ?? defaultDimensions[model];
    if (!dimensions) throw new Error(`Dimensions required for model: ${model}`);
    return { model, dimensions };
  });
  const models = values.has("specs")
    ? csv(values.get("specs")!).map(parseSpec)
    : values.has("models") || values.has("dimensions")
      ? legacyModels
      : [
          { model: "text-embedding-3-small", dimensions: 512 },
          { model: "text-embedding-3-small", dimensions: 1536 },
          { model: "text-embedding-3-large", dimensions: 3072 }
        ];
  const allowedChunkStrategies = new Set<ChunkStrategy>(["event_summary", "user_only", "dialogue_window"]);
  const chunkStrategies = csv(values.get("chunk-strategies") ?? "event_summary,user_only,dialogue_window");
  if (chunkStrategies.some((strategy) => !allowedChunkStrategies.has(strategy as ChunkStrategy))) {
    throw new Error(`Invalid chunk-strategies: ${values.get("chunk-strategies")}`);
  }
  const topKs = numberCsv(values.get("top-k") ?? "1,3,5", "top-k", { integer: true, min: 1 });
  const thresholds = numberCsv(
    values.get("thresholds") ?? "0.50,0.55,0.60,0.65,0.70,0.75,0.80,0.85,0.90",
    "thresholds",
    { min: -1, max: 1 }
  );
  const batchSize = Number(values.get("batch-size") ?? 64);
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batch-size must be a positive integer");
  const knownKeys = new Set(["specs", "models", "dimensions", "chunk-strategies", "top-k", "thresholds", "batch-size", "output-dir"]);
  const knownFlags = new Set(["ignore-cache"]);
  for (const key of values.keys()) if (!knownKeys.has(key)) throw new Error(`Unknown option: --${key}`);
  for (const key of flags) if (!knownFlags.has(key)) throw new Error(`Unknown flag: --${key}`);

  return {
    models,
    chunkStrategies: chunkStrategies as ChunkStrategy[],
    topKs,
    thresholds,
    batchSize,
    ignoreCache: flags.has("ignore-cache"),
    outputDir: values.get("output-dir")
  };
}

function parseSpec(entry: string): EmbeddingModelSpec {
  const separator = entry.lastIndexOf(":");
  const model = entry.slice(0, separator);
  const dimensions = Number(entry.slice(separator + 1));
  if (!model || !Number.isInteger(dimensions) || dimensions < 1) throw new Error(`Invalid spec: ${entry}`);
  return { model, dimensions };
}

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function numberCsv(value: string, name: string, limits: { integer?: boolean; min?: number; max?: number }) {
  const numbers = csv(value).map(Number);
  if (!numbers.length || numbers.some((number) =>
    !Number.isFinite(number) ||
    (limits.integer && !Number.isInteger(number)) ||
    (limits.min !== undefined && number < limits.min) ||
    (limits.max !== undefined && number > limits.max)
  )) throw new Error(`Invalid ${name}: ${value}`);
  return [...new Set(numbers)].sort((left, right) => left - right);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[retrieval-eval] ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exitCode = 1;
  });
}
