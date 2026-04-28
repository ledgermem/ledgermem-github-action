// LedgerMem GitHub Action — bundled entry.
//
// This file is a build artifact produced by `npm run build`
// (`@vercel/ncc build src/index.ts -o dist`). It is checked in so the action
// can be used directly without a build step in the consumer workflow.
//
// To regenerate: `npm install && npm run build`.

"use strict";

const core = require("@actions/core");
const { LedgerMemClient } = require("@ledgermem/memory");

function readInputs() {
  const operationRaw = (core.getInput("operation", { required: true }) || "")
    .toLowerCase()
    .trim();
  if (operationRaw !== "add" && operationRaw !== "search") {
    throw new Error(
      "Invalid operation '" + operationRaw + "'. Must be 'add' or 'search'."
    );
  }
  const limitRaw = core.getInput("limit") || "10";
  const limit = parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid limit '" + limitRaw + "'. Must be between 1 and 100.");
  }
  const metadataRaw = core.getInput("metadata") || "{}";
  let metadata;
  try {
    metadata = JSON.parse(metadataRaw);
  } catch (err) {
    throw new Error("Invalid metadata JSON: " + (err && err.message ? err.message : err));
  }
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error("metadata must be a JSON object.");
  }

  return {
    apiKey: core.getInput("api-key", { required: true }),
    workspaceId: core.getInput("workspace-id", { required: true }),
    operation: operationRaw,
    content: core.getInput("content"),
    query: core.getInput("query"),
    limit: limit,
    endpoint: core.getInput("endpoint") || "https://api.ledgermem.dev",
    metadata: metadata,
  };
}

function coerceMemory(raw) {
  raw = raw || {};
  return {
    id: String(raw.id || ""),
    content: String(raw.content || ""),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    score: typeof raw.score === "number" ? raw.score : undefined,
    metadata: raw.metadata || undefined,
  };
}

async function run() {
  let inputs;
  try {
    inputs = readInputs();
  } catch (err) {
    core.setFailed(err && err.message ? err.message : String(err));
    return;
  }

  const sdk = new LedgerMemClient({ apiKey: inputs.apiKey, baseUrl: inputs.endpoint });

  try {
    if (inputs.operation === "search") {
      if (!inputs.query.trim()) {
        core.setFailed("operation=search requires the 'query' input.");
        return;
      }
      const raw = await sdk.search({
        query: inputs.query,
        workspaceId: inputs.workspaceId,
        limit: inputs.limit,
      });
      const results = (raw || []).map(coerceMemory);
      core.setOutput("results", JSON.stringify(results));
      core.setOutput("memory-id", "");
      core.info("LedgerMem returned " + results.length + " result(s).");
      try {
        await core.summary
          .addHeading("LedgerMem search: " + inputs.query, 2)
          .addRaw("Returned **" + results.length + "** result(s).")
          .write();
      } catch (_) {
        // summary unavailable in some runners — non-fatal
      }
      return;
    }

    if (!inputs.content.trim()) {
      core.setFailed("operation=add requires the 'content' input.");
      return;
    }
    const memory = coerceMemory(
      await sdk.add({
        content: inputs.content,
        workspaceId: inputs.workspaceId,
        metadata: Object.assign(
          {},
          inputs.metadata,
          {
            source: "github-actions",
            runId: process.env.GITHUB_RUN_ID || "",
            repository: process.env.GITHUB_REPOSITORY || "",
          }
        ),
      })
    );
    core.setOutput("results", "[]");
    core.setOutput("memory-id", memory.id);
    core.info("Saved memory " + memory.id);
  } catch (err) {
    core.setFailed(err && err.message ? err.message : String(err));
  }
}

module.exports = { run, readInputs };

if (require.main === module) {
  run();
}
