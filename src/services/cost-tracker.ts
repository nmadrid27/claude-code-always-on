// src/services/cost-tracker.ts
// In-memory API cost tracking per invocation and per user
// Data resets on restart -- no database dependency required

import { createLogger } from "./logger.js";

const log = createLogger("cost-tracker");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostEntry {
  userId: number;
  timestamp: number;
  cost: number;
  tokensUsed: number;
  durationMs: number;
  operation: string;
}

interface UserStats {
  totalCost: number;
  totalTokens: number;
  invocations: number;
}

// ---------------------------------------------------------------------------
// Storage (in-memory)
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 10_000;
const entries: CostEntry[] = [];
const startTime = Date.now();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a cost entry after a Claude Code invocation.
 */
export function recordCost(entry: CostEntry): void {
  entries.push(entry);

  // Cap entries to prevent unbounded memory growth
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }

  log.debug("Cost recorded", {
    userId: entry.userId,
    cost: entry.cost,
    tokens: entry.tokensUsed,
  });
}

/**
 * Estimate cost from token count.
 * Uses approximate Claude Sonnet pricing ($3/M input + $15/M output).
 * Since we only get total tokens, use a blended rate of ~$6/M tokens.
 */
export function estimateCost(tokensUsed: number): number {
  return (tokensUsed / 1_000_000) * 6;
}

/**
 * Get aggregated stats for a specific user.
 */
export function getUserStats(userId: number): UserStats {
  let totalCost = 0;
  let totalTokens = 0;
  let invocations = 0;

  for (const e of entries) {
    if (e.userId === userId) {
      totalCost += e.cost;
      totalTokens += e.tokensUsed;
      invocations++;
    }
  }

  return { totalCost, totalTokens, invocations };
}

/**
 * Get global stats across all users since last restart.
 */
export function getGlobalStats(): {
  totalCost: number;
  totalTokens: number;
  totalInvocations: number;
  uptimeMs: number;
  recentErrors: number;
} {
  let totalCost = 0;
  let totalTokens = 0;

  for (const e of entries) {
    totalCost += e.cost;
    totalTokens += e.tokensUsed;
  }

  return {
    totalCost,
    totalTokens,
    totalInvocations: entries.length,
    uptimeMs: Date.now() - startTime,
    recentErrors: errorCount,
  };
}

/**
 * Format user stats for display in Telegram /costs command.
 */
export function formatCostsMessage(userId: number): string {
  const stats = getUserStats(userId);

  if (stats.invocations === 0) {
    return "No usage recorded since last restart.";
  }

  const avgTokens = Math.round(stats.totalTokens / stats.invocations);

  return (
    "*Usage Stats (this session)*\n\n" +
    `Invocations: ${stats.invocations}\n` +
    `Total tokens: ${stats.totalTokens.toLocaleString()}\n` +
    `Avg tokens/request: ${avgTokens.toLocaleString()}\n` +
    `Estimated cost: $${stats.totalCost.toFixed(4)}\n`
  );
}

// ---------------------------------------------------------------------------
// Error tracking (simple counter for /health)
// ---------------------------------------------------------------------------

let errorCount = 0;

export function incrementErrors(): void {
  errorCount++;
}

export function getErrorCount(): number {
  return errorCount;
}
