// src/__tests__/watchdog.test.ts
import { describe, it, expect } from "bun:test";
import { isHeartbeatStale, HEARTBEAT_STALE_MS } from "../../scripts/watchdog.js";

const NOW = 1_800_000_000_000; // fixed reference (ms)

describe("isHeartbeatStale", () => {
  it("treats a missing heartbeat as stale (bot down)", () => {
    expect(isHeartbeatStale(null, NOW)).toBe(true);
  });

  it("is not stale for a fresh heartbeat", () => {
    const epochSeconds = Math.floor(NOW / 1000);
    expect(isHeartbeatStale(epochSeconds, NOW)).toBe(false);
  });

  it("is not stale just under the threshold", () => {
    const epochSeconds = Math.floor((NOW - (HEARTBEAT_STALE_MS - 1000)) / 1000);
    expect(isHeartbeatStale(epochSeconds, NOW)).toBe(false);
  });

  it("is stale past the threshold", () => {
    const epochSeconds = Math.floor((NOW - (HEARTBEAT_STALE_MS + 60_000)) / 1000);
    expect(isHeartbeatStale(epochSeconds, NOW)).toBe(true);
  });

  it("respects a custom threshold", () => {
    const epochSeconds = Math.floor((NOW - 5 * 60_000) / 1000); // 5 min old
    expect(isHeartbeatStale(epochSeconds, NOW, 3 * 60_000)).toBe(true);
    expect(isHeartbeatStale(epochSeconds, NOW, 10 * 60_000)).toBe(false);
  });
});
