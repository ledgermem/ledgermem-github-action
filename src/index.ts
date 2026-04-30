import * as core from "@actions/core";
import { MnemoClient } from "@mnemo/memory";

type Operation = "add" | "search";

interface Inputs {
  apiKey: string;
  workspaceId: string;
  operation: Operation;
  content: string;
  query: string;
  limit: number;
  endpoint: string;
  metadata: Record<string, unknown>;
}

export interface Memory {
  id: string;
  content: string;
  createdAt: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export function readInputs(): Inputs {
  const operationRaw = core.getInput("operation", { required: true }).toLowerCase().trim();
  if (operationRaw !== "add" && operationRaw !== "search") {
    throw new Error(`Invalid operation '${operationRaw}'. Must be 'add' or 'search'.`);
  }
  const limitRaw = core.getInput("limit") || "10";
  const limit = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    throw new Error(`Invalid limit '${limitRaw}'. Must be between 1 and 100.`);
  }
  const metadataRaw = core.getInput("metadata") || "{}";
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(metadataRaw);
  } catch (err) {
    throw new Error(
      `Invalid metadata JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
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
    limit,
    endpoint: core.getInput("endpoint") || "https://api.getmnemo.dev",
    metadata,
  };
}

interface ClientLike {
  search(args: {
    query: string;
    workspaceId: string;
    limit: number;
  }): Promise<readonly Memory[]>;
  add(args: {
    content: string;
    workspaceId: string;
    metadata: Record<string, unknown>;
  }): Promise<Memory>;
}

export async function run(
  clientFactory: (apiKey: string, baseUrl: string) => ClientLike = defaultClientFactory,
): Promise<void> {
  let inputs: Inputs;
  try {
    inputs = readInputs();
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
    return;
  }

  // Register the API key as a secret so the runner masks it from any
  // subsequent log output — including stack traces, network errors, or
  // anything else that might echo the input back. Without this, a
  // misconfigured workflow that passes the key plainly (instead of via
  // secrets.*) would leak it on every run.
  if (inputs.apiKey) {
    core.setSecret(inputs.apiKey);
  }

  const client = clientFactory(inputs.apiKey, inputs.endpoint);

  try {
    if (inputs.operation === "search") {
      if (!inputs.query.trim()) {
        core.setFailed("operation=search requires the 'query' input.");
        return;
      }
      const results = await client.search({
        query: inputs.query,
        workspaceId: inputs.workspaceId,
        limit: inputs.limit,
      });
      core.setOutput("results", JSON.stringify(results));
      core.setOutput("memory-id", "");
      core.info(`Mnemo returned ${results.length} result(s).`);
      // `core.summary.write()` returns a Promise — without `await`, the
      // process can exit before the summary file is flushed and the action
      // run shows no summary in the GitHub UI even though the operation
      // succeeded.
      await core.summary
        .addHeading(`Mnemo search: ${inputs.query}`, 2)
        .addRaw(`Returned **${results.length}** result(s).`)
        .write();
      return;
    }

    if (!inputs.content.trim()) {
      core.setFailed("operation=add requires the 'content' input.");
      return;
    }
    const memory = await client.add({
      content: inputs.content,
      workspaceId: inputs.workspaceId,
      // Spread user-supplied metadata FIRST so the trusted provenance
      // fields (source, runId, repository) cannot be forged from the
      // workflow input — important when a workflow is triggered by a
      // pull_request from a fork.
      metadata: {
        ...inputs.metadata,
        source: "github-actions",
        runId: process.env.GITHUB_RUN_ID ?? "",
        repository: process.env.GITHUB_REPOSITORY ?? "",
      },
    });
    core.setOutput("results", "[]");
    core.setOutput("memory-id", memory.id);
    core.info(`Saved memory ${memory.id}`);
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

function defaultClientFactory(apiKey: string, baseUrl: string): ClientLike {
  const sdk = new MnemoClient({ apiKey, baseUrl });
  return {
    async search(args): Promise<readonly Memory[]> {
      const results = await sdk.search(args);
      return results.map((r: unknown) => coerceMemory(r));
    },
    async add(args): Promise<Memory> {
      return coerceMemory(await sdk.add(args));
    },
  };
}

function coerceMemory(raw: unknown): Memory {
  const r = raw as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    content: String(r.content ?? ""),
    createdAt: String(r.createdAt ?? new Date().toISOString()),
    score: typeof r.score === "number" ? r.score : undefined,
    metadata: (r.metadata as Record<string, unknown>) ?? undefined,
  };
}

// Entry point for the bundled action.
if (require.main === module) {
  void run();
}
