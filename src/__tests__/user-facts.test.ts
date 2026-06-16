// src/__tests__/user-facts.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { openDatabase } from "../database/sqlite.js";
import type { BotDatabase } from "../database/sqlite.js";
import {
  upsertUserFact,
  getUserFacts,
  getFactsByType,
  searchRelevantFacts,
  updateFactConfidence,
  updateFactEmbedding,
  deleteFact,
  deleteFactsByType,
  getFactsSummary,
  storeInferredFacts,
} from "../database/user-facts.js";

const USER = 11;
let db: BotDatabase;
beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("upsertUserFact", () => {
  it("creates a fact", async () => {
    const f = await upsertUserFact(db, USER, "preference", "likes tea", 8);
    expect(f).not.toBeNull();
    expect(f!.fact_type).toBe("preference");
    expect(f!.fact_text).toBe("likes tea");
    expect(f!.confidence).toBe(8);
    expect(f!.access_count).toBe(0);
  });

  it("updates instead of duplicating on conflict", async () => {
    await upsertUserFact(db, USER, "preference", "likes tea", 5);
    await upsertUserFact(db, USER, "preference", "likes tea", 9, "manual");
    const all = await getUserFacts(db, USER, undefined, 1);
    expect(all).toHaveLength(1);
    expect(all[0]!.confidence).toBe(9);
  });

  it("clamps confidence into 1-10", async () => {
    const hi = await upsertUserFact(db, USER, "context", "a", 50);
    const lo = await upsertUserFact(db, USER, "context", "b", -3);
    expect(hi!.confidence).toBe(10);
    expect(lo!.confidence).toBe(1);
  });
});

describe("getUserFacts", () => {
  it("filters by minimum confidence and orders by confidence desc", async () => {
    await upsertUserFact(db, USER, "context", "weak", 2);
    await upsertUserFact(db, USER, "context", "strong", 9);
    const facts = await getUserFacts(db, USER, undefined, 5);
    expect(facts.map((f) => f.fact_text)).toEqual(["strong"]);
  });

  it("filters by type", async () => {
    await upsertUserFact(db, USER, "preference", "tea", 8);
    await upsertUserFact(db, USER, "skill", "guitar", 8);
    const prefs = await getFactsByType(db, USER, "preference");
    expect(prefs.map((f) => f.fact_text)).toEqual(["tea"]);
  });

  it("increments access_count on each read", async () => {
    await upsertUserFact(db, USER, "context", "tracked", 8);
    await getUserFacts(db, USER, undefined, 1); // read 1 -> count becomes 1
    const second = await getUserFacts(db, USER, undefined, 1); // returns count after read 1
    expect(second[0]!.access_count).toBe(1);
  });
});

describe("searchRelevantFacts", () => {
  it("returns facts above threshold by similarity", async () => {
    const match = await upsertUserFact(db, USER, "interest", "cats", 8, undefined, [1, 0, 0]);
    await upsertUserFact(db, USER, "interest", "taxes", 8, undefined, [0, 1, 0]);
    const results = await searchRelevantFacts(db, [0.95, 0.05, 0], USER, 5, 0.5);
    expect(results.map((r) => r.id)).toEqual([match!.id]);
    expect(results[0]!.fact_text).toBe("cats");
  });

  it("finds a fact after a late embedding update", async () => {
    const f = await upsertUserFact(db, USER, "interest", "late", 8);
    await updateFactEmbedding(db, f!.id, [0, 1]);
    const results = await searchRelevantFacts(db, [0, 1], USER, 5, 0.5);
    expect(results[0]!.id).toBe(f!.id);
  });
});

describe("update / delete / summary", () => {
  it("updates confidence with clamping", async () => {
    const f = await upsertUserFact(db, USER, "context", "x", 5);
    expect(await updateFactConfidence(db, f!.id, 99)).toBe(true);
    const [updated] = await getUserFacts(db, USER, undefined, 1);
    expect(updated!.confidence).toBe(10);
  });

  it("deletes a fact", async () => {
    const f = await upsertUserFact(db, USER, "context", "x", 5);
    expect(await deleteFact(db, f!.id)).toBe(true);
    expect(await getUserFacts(db, USER, undefined, 1)).toHaveLength(0);
  });

  it("deletes facts by type and returns the count", async () => {
    await upsertUserFact(db, USER, "habit", "a", 5);
    await upsertUserFact(db, USER, "habit", "b", 5);
    await upsertUserFact(db, USER, "skill", "c", 5);
    expect(await deleteFactsByType(db, USER, "habit")).toBe(2);
    expect(await getUserFacts(db, USER, undefined, 1)).toHaveLength(1);
  });

  it("formats a facts summary grouped by type", async () => {
    await upsertUserFact(db, USER, "preference", "tea", 8);
    const summary = await getFactsSummary(db, USER, 5);
    expect(summary).toContain("## User Facts");
    expect(summary).toContain("**Preferences:**");
    expect(summary).toContain("- tea (confidence: 8)");
  });

  it("returns empty summary when no qualifying facts", async () => {
    await upsertUserFact(db, USER, "preference", "weak", 2);
    expect(await getFactsSummary(db, USER, 5)).toBe("");
  });

  it("storeInferredFacts stores multiple and returns count", async () => {
    const n = await storeInferredFacts(db, USER, [
      { type: "preference", text: "p1", confidence: 6 },
      { type: "skill", text: "s1", confidence: 7 },
    ]);
    expect(n).toBe(2);
    expect(await getUserFacts(db, USER, undefined, 1)).toHaveLength(2);
  });
});
