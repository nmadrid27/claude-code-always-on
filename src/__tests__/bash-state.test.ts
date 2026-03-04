// src/__tests__/bash-state.test.ts
import { describe, it, expect, beforeEach } from "bun:test";

// We'll test the pure state logic before wiring it into bot.ts.
// This validates state transitions in isolation.
type BashState = "bash_pending" | "bash_ready";

function createBashStateMap() {
  return new Map<number, BashState>();
}

describe("bash state machine", () => {
  let stateMap: Map<number, BashState>;
  const USER = 12345678;

  beforeEach(() => {
    stateMap = createBashStateMap();
  });

  it("starts with no state (read-only)", () => {
    expect(stateMap.get(USER)).toBeUndefined();
  });

  it("/bash sets state to bash_pending", () => {
    stateMap.set(USER, "bash_pending");
    expect(stateMap.get(USER)).toBe("bash_pending");
  });

  it("/confirm when bash_pending sets state to bash_ready", () => {
    stateMap.set(USER, "bash_pending");
    if (stateMap.get(USER) === "bash_pending") {
      stateMap.set(USER, "bash_ready");
    }
    expect(stateMap.get(USER)).toBe("bash_ready");
  });

  it("/confirm when NOT bash_pending does not change state", () => {
    if (stateMap.get(USER) === "bash_pending") {
      stateMap.set(USER, "bash_ready");
    }
    expect(stateMap.get(USER)).toBeUndefined();
  });

  it("non-/confirm message when bash_pending clears state", () => {
    stateMap.set(USER, "bash_pending");
    if (stateMap.get(USER) === "bash_pending") {
      stateMap.delete(USER);
    }
    expect(stateMap.get(USER)).toBeUndefined();
  });

  it("message when bash_ready uses elevated tools then clears state", () => {
    stateMap.set(USER, "bash_ready");
    const state = stateMap.get(USER);
    const tools = state === "bash_ready"
      ? ["bash", "read", "write"]
      : ["read"];
    stateMap.delete(USER);
    expect(tools).toEqual(["bash", "read", "write"]);
    expect(stateMap.get(USER)).toBeUndefined();
  });

  it("tools default to read-only when no state", () => {
    const state = stateMap.get(USER);
    const tools = state === "bash_ready"
      ? ["bash", "read", "write"]
      : ["read"];
    expect(tools).toEqual(["read"]);
  });
});
