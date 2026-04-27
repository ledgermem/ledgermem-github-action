import { describe, it, expect, vi, beforeEach } from "vitest";

const inputs = new Map<string, string>();
const outputs = new Map<string, string>();
const failures: string[] = [];
const infos: string[] = [];

vi.mock("@actions/core", () => {
  return {
    getInput: (name: string, opts?: { required?: boolean }): string => {
      const v = inputs.get(name) ?? "";
      if (opts?.required && !v) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return v;
    },
    setOutput: (name: string, value: string): void => {
      outputs.set(name, value);
    },
    setFailed: (msg: string): void => {
      failures.push(msg);
    },
    info: (msg: string): void => {
      infos.push(msg);
    },
    summary: {
      addHeading: vi.fn().mockReturnThis(),
      addRaw: vi.fn().mockReturnThis(),
      write: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("@ledgermem/memory", () => {
  return {
    LedgerMemClient: class {
      async search(args: { query: string }): Promise<unknown[]> {
        return [
          { id: "m1", content: `match for ${args.query}`, createdAt: "2026-01-01", score: 0.92 },
        ];
      }
      async add(args: { content: string }): Promise<unknown> {
        return { id: "new-id", content: args.content, createdAt: "2026-01-01" };
      }
    },
  };
});

import { run, readInputs } from "./index";

beforeEach(() => {
  inputs.clear();
  outputs.clear();
  failures.length = 0;
  infos.length = 0;
});

describe("readInputs", () => {
  it("rejects an unknown operation", () => {
    inputs.set("api-key", "k");
    inputs.set("workspace-id", "w");
    inputs.set("operation", "delete");
    expect(() => readInputs()).toThrow(/Invalid operation/);
  });

  it("rejects a non-numeric limit", () => {
    inputs.set("api-key", "k");
    inputs.set("workspace-id", "w");
    inputs.set("operation", "search");
    inputs.set("limit", "abc");
    expect(() => readInputs()).toThrow(/Invalid limit/);
  });

  it("rejects malformed metadata JSON", () => {
    inputs.set("api-key", "k");
    inputs.set("workspace-id", "w");
    inputs.set("operation", "add");
    inputs.set("metadata", "{not-json");
    expect(() => readInputs()).toThrow(/metadata/);
  });
});

describe("run (search)", () => {
  it("writes results to outputs", async () => {
    inputs.set("api-key", "k");
    inputs.set("workspace-id", "w");
    inputs.set("operation", "search");
    inputs.set("query", "hello");
    inputs.set("limit", "5");

    await run();

    expect(failures).toEqual([]);
    expect(outputs.get("memory-id")).toBe("");
    const parsed = JSON.parse(outputs.get("results") ?? "[]");
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("m1");
  });

  it("fails when query is empty", async () => {
    inputs.set("api-key", "k");
    inputs.set("workspace-id", "w");
    inputs.set("operation", "search");
    inputs.set("query", "");

    await run();
    expect(failures[0]).toMatch(/query/);
  });
});

describe("run (add)", () => {
  it("returns the new memory id", async () => {
    inputs.set("api-key", "k");
    inputs.set("workspace-id", "w");
    inputs.set("operation", "add");
    inputs.set("content", "save this");

    await run();
    expect(failures).toEqual([]);
    expect(outputs.get("memory-id")).toBe("new-id");
    expect(outputs.get("results")).toBe("[]");
  });

  it("fails when content is empty", async () => {
    inputs.set("api-key", "k");
    inputs.set("workspace-id", "w");
    inputs.set("operation", "add");
    inputs.set("content", "");

    await run();
    expect(failures[0]).toMatch(/content/);
  });

  it("supports an injected client factory for offline tests", async () => {
    inputs.set("api-key", "k");
    inputs.set("workspace-id", "w");
    inputs.set("operation", "add");
    inputs.set("content", "from injected");

    await run(() => ({
      async search() {
        return [];
      },
      async add(): Promise<{ id: string; content: string; createdAt: string }> {
        return { id: "injected", content: "from injected", createdAt: "2026-01-01" };
      },
    }));
    expect(outputs.get("memory-id")).toBe("injected");
  });
});
