// src/__tests__/relay-retry.test.ts
import { describe, it, expect } from "bun:test";
import {
  resolveTimeout,
  invokeClaudeCodeWithRetry,
  type ClaudeCodeRequest,
  type ClaudeCodeResponse,
} from "../relay.js";

describe("resolveTimeout", () => {
  const ORIGINAL = process.env.CLAUDE_TIMEOUT;
  const restore = () => {
    if (ORIGINAL === undefined) delete process.env.CLAUDE_TIMEOUT;
    else process.env.CLAUDE_TIMEOUT = ORIGINAL;
  };

  it("defaults to 300000 (5 min) with no env and no override", () => {
    delete process.env.CLAUDE_TIMEOUT;
    expect(resolveTimeout()).toBe(300000);
    restore();
  });

  it("uses CLAUDE_TIMEOUT env when set", () => {
    process.env.CLAUDE_TIMEOUT = "420000";
    expect(resolveTimeout()).toBe(420000);
    restore();
  });

  it("lets an explicit per-request timeout win over env", () => {
    process.env.CLAUDE_TIMEOUT = "420000";
    expect(resolveTimeout(90000)).toBe(90000);
    restore();
  });

  it("ignores blank, non-numeric, or non-positive env values", () => {
    process.env.CLAUDE_TIMEOUT = "   ";
    expect(resolveTimeout()).toBe(300000);
    process.env.CLAUDE_TIMEOUT = "not-a-number";
    expect(resolveTimeout()).toBe(300000);
    process.env.CLAUDE_TIMEOUT = "0";
    expect(resolveTimeout()).toBe(300000);
    restore();
  });
});

describe("invokeClaudeCodeWithRetry", () => {
  const REQ: ClaudeCodeRequest = { prompt: "hello" };

  // Build a fake invoker that returns a queued sequence of responses
  const fakeInvoker = (sequence: ClaudeCodeResponse[]) => {
    let calls = 0;
    const fn = async (): Promise<ClaudeCodeResponse> => {
      const r = sequence[Math.min(calls, sequence.length - 1)]!;
      calls++;
      return r;
    };
    return { fn, getCalls: () => calls };
  };

  const ok: ClaudeCodeResponse = { success: true, output: "done" };
  const timedOut: ClaudeCodeResponse = {
    success: false,
    error: "Claude Code invocation timed out after 300000ms",
    timedOut: true,
  };
  const hardFail: ClaudeCodeResponse = {
    success: false,
    error: "Claude Code exited with code 1",
  };

  it("returns immediately on success without retrying", async () => {
    const { fn, getCalls } = fakeInvoker([ok]);
    const res = await invokeClaudeCodeWithRetry(REQ, {}, fn);
    expect(res.success).toBe(true);
    expect(getCalls()).toBe(1);
  });

  it("retries once on timeout, then returns the successful result", async () => {
    const { fn, getCalls } = fakeInvoker([timedOut, ok]);
    let retried = 0;
    const res = await invokeClaudeCodeWithRetry(
      REQ,
      { onTimeoutRetry: () => { retried++; } },
      fn,
    );
    expect(res.success).toBe(true);
    expect(getCalls()).toBe(2);
    expect(retried).toBe(1);
  });

  it("does NOT retry on a non-timeout failure", async () => {
    const { fn, getCalls } = fakeInvoker([hardFail, ok]);
    let retried = 0;
    const res = await invokeClaudeCodeWithRetry(
      REQ,
      { onTimeoutRetry: () => { retried++; } },
      fn,
    );
    expect(res.success).toBe(false);
    expect(getCalls()).toBe(1);
    expect(retried).toBe(0);
  });

  it("gives up after maxTimeoutRetries and returns the last timed-out response", async () => {
    const { fn, getCalls } = fakeInvoker([timedOut, timedOut, ok]);
    let retried = 0;
    const res = await invokeClaudeCodeWithRetry(
      REQ,
      { maxTimeoutRetries: 1, onTimeoutRetry: () => { retried++; } },
      fn,
    );
    expect(res.success).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(getCalls()).toBe(2); // 1 initial + 1 retry
    expect(retried).toBe(1);
  });
});
