import type { RetrievalEvalDataset, RetrievalEvalDatasetV2 } from "./types.js";

const forbiddenSensitiveLevels = new Set(["sensitive", "crisis"]);

export function validateRetrievalEvalDataset(dataset: RetrievalEvalDataset | RetrievalEvalDatasetV2) {
  const issues: string[] = [];
  const userIds = new Set<string>();
  const chunkOwners = new Map<string, string>();
  const chunkSensitivity = new Map<string, string>();
  const caseIds = new Set<string>();

  if (dataset.version !== "1.0.0" && dataset.version !== "2.0.0") issues.push("unsupported dataset version");
  if (dataset.source !== "synthetic") issues.push("dataset source must be synthetic");
  if (dataset.locale !== "zh-TW") issues.push("dataset locale must be zh-TW");
  if (dataset.users.length !== 8) issues.push(`expected 8 users, received ${dataset.users.length}`);
  if (dataset.cases.length !== 40) issues.push(`expected 40 cases, received ${dataset.cases.length}`);

  for (const user of dataset.users) {
    if (userIds.has(user.id)) issues.push(`duplicate user id: ${user.id}`);
    userIds.add(user.id);
    if (!user.id.startsWith("synthetic-user-")) issues.push(`non-synthetic user id: ${user.id}`);
    if (!user.profile.trim()) issues.push(`empty profile: ${user.id}`);

    for (const chunk of user.chunks) {
      if (chunkOwners.has(chunk.id)) issues.push(`duplicate chunk id: ${chunk.id}`);
      chunkOwners.set(chunk.id, user.id);
      chunkSensitivity.set(chunk.id, chunk.sensitivity);
      if (chunk.userId !== user.id) issues.push(`chunk owner mismatch: ${chunk.id}`);
      if (!chunk.content.trim()) issues.push(`empty chunk content: ${chunk.id}`);
      if (dataset.version === "2.0.0") {
        if (!("sourceMessages" in chunk) || chunk.sourceMessages.length !== 3) {
          issues.push(`chunk must have three source messages: ${chunk.id}`);
        } else {
          const expectedRoles = ["user", "assistant", "user"];
          chunk.sourceMessages.forEach((message, index) => {
            if (message.role !== expectedRoles[index]) issues.push(`invalid source role at ${chunk.id}:${index}`);
            if (!message.content.trim()) issues.push(`empty source message at ${chunk.id}:${index}`);
          });
        }
      }
    }
  }

  let noRecallCases = 0;
  const casesPerUser = new Map<string, number>();
  for (const evalCase of dataset.cases) {
    if (caseIds.has(evalCase.id)) issues.push(`duplicate case id: ${evalCase.id}`);
    caseIds.add(evalCase.id);
    casesPerUser.set(evalCase.userId, (casesPerUser.get(evalCase.userId) ?? 0) + 1);
    if (!userIds.has(evalCase.userId)) issues.push(`unknown case user: ${evalCase.id}`);
    if (!evalCase.query.trim()) issues.push(`empty query: ${evalCase.id}`);
    if (evalCase.recentContext.length > 2) issues.push(`too much recent context: ${evalCase.id}`);
    if (!evalCase.rationale.trim()) issues.push(`empty rationale: ${evalCase.id}`);
    if (!evalCase.labels.forbidden.length) issues.push(`case has no forbidden label: ${evalCase.id}`);
    if (!evalCase.labels.mustRetrieve.length && !evalCase.labels.acceptable.length) noRecallCases += 1;

    const labelGroups = [
      ["mustRetrieve", evalCase.labels.mustRetrieve],
      ["acceptable", evalCase.labels.acceptable],
      ["forbidden", evalCase.labels.forbidden]
    ] as const;
    const seenLabels = new Set<string>();

    for (const [label, ids] of labelGroups) {
      for (const chunkId of ids) {
        if (seenLabels.has(chunkId)) issues.push(`overlapping labels in ${evalCase.id}: ${chunkId}`);
        seenLabels.add(chunkId);
        const owner = chunkOwners.get(chunkId);
        if (!owner) issues.push(`unknown chunk in ${evalCase.id}: ${chunkId}`);
        else if (owner !== evalCase.userId) issues.push(`cross-user label in ${evalCase.id}: ${chunkId}`);
        if (label !== "forbidden" && forbiddenSensitiveLevels.has(chunkSensitivity.get(chunkId) ?? "")) {
          issues.push(`sensitive chunk must be forbidden in ${evalCase.id}: ${chunkId}`);
        }
      }
    }
  }

  if (noRecallCases < 8) issues.push(`expected at least 8 no-recall cases, received ${noRecallCases}`);
  for (const userId of userIds) {
    if (casesPerUser.get(userId) !== 5) {
      issues.push(`expected 5 cases for ${userId}, received ${casesPerUser.get(userId) ?? 0}`);
    }
  }

  return issues;
}

export function assertValidRetrievalEvalDataset(dataset: RetrievalEvalDataset | RetrievalEvalDatasetV2) {
  const issues = validateRetrievalEvalDataset(dataset);
  if (issues.length) throw new Error(`Invalid retrieval eval dataset:\n- ${issues.join("\n- ")}`);
}
