// src/__tests__/relay-output.test.ts
import { describe, it, expect } from "bun:test";
import { extractClaudeResult, resolveModel } from "../relay.js";

describe("resolveModel", () => {
  const ORIGINAL = process.env.CLAUDE_MODEL;
  const restore = () => {
    if (ORIGINAL === undefined) delete process.env.CLAUDE_MODEL;
    else process.env.CLAUDE_MODEL = ORIGINAL;
  };

  it("defaults to claude-sonnet-4-6 with no env and no override", () => {
    delete process.env.CLAUDE_MODEL;
    expect(resolveModel()).toBe("claude-sonnet-4-6");
    restore();
  });

  it("uses CLAUDE_MODEL env when set", () => {
    process.env.CLAUDE_MODEL = "claude-haiku-4-5";
    expect(resolveModel()).toBe("claude-haiku-4-5");
    restore();
  });

  it("lets an explicit per-request model win over env", () => {
    process.env.CLAUDE_MODEL = "claude-haiku-4-5";
    expect(resolveModel("claude-opus-4-8")).toBe("claude-opus-4-8");
    restore();
  });

  it("ignores blank/whitespace env values", () => {
    process.env.CLAUDE_MODEL = "   ";
    expect(resolveModel()).toBe("claude-sonnet-4-6");
    restore();
  });
});

describe("extractClaudeResult", () => {
  it("extracts text + tokens from the modern array (stream-json) output", () => {
    const parsed = [
      { type: "system", subtype: "init", session_id: "abc", tools: [] },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "partial" }] },
      },
      {
        type: "result",
        subtype: "success",
        result: "Hello! How can I help you today?",
        usage: { input_tokens: 12, output_tokens: 8 },
        total_cost_usd: 0.0001,
      },
    ];
    const out = extractClaudeResult(parsed);
    expect(out.outputText).toBe("Hello! How can I help you today?");
    expect(out.tokensUsed).toBe(20); // 12 + 8
  });

  it("reads total_tokens when present in usage", () => {
    const parsed = [
      { type: "result", subtype: "success", result: "hi", usage: { total_tokens: 42 } },
    ];
    expect(extractClaudeResult(parsed).tokensUsed).toBe(42);
  });

  it("falls back to concatenated assistant text when no result event", () => {
    const parsed = [
      { type: "system", subtype: "init" },
      { type: "assistant", message: { content: [{ type: "text", text: "part one " }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "part two" }] } },
    ];
    expect(extractClaudeResult(parsed).outputText).toBe("part one part two");
  });

  it("handles the legacy single result object", () => {
    const parsed = {
      type: "result",
      result: "legacy answer",
      usage: { total_tokens: 5 },
    };
    const out = extractClaudeResult(parsed);
    expect(out.outputText).toBe("legacy answer");
    expect(out.tokensUsed).toBe(5);
  });

  it("handles legacy objects using alternate field names", () => {
    expect(extractClaudeResult({ output: "via output" }).outputText).toBe("via output");
    expect(extractClaudeResult({ text: "via text" }).outputText).toBe("via text");
  });

  it("handles a plain string", () => {
    expect(extractClaudeResult("just text").outputText).toBe("just text");
  });

  it("returns empty string for unrecognized shapes", () => {
    expect(extractClaudeResult([{ type: "system", subtype: "init" }]).outputText).toBe("");
    expect(extractClaudeResult({}).outputText).toBe("");
    expect(extractClaudeResult(null).outputText).toBe("");
  });
});
