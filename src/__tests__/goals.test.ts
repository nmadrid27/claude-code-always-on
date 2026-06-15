// src/__tests__/goals.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { openDatabase } from "../database/sqlite.js";
import type { BotDatabase } from "../database/sqlite.js";
import {
  createGoal,
  getGoals,
  getActiveGoals,
  getAllActiveGoals,
  updateGoalStatus,
  completeGoal,
  archiveGoal,
  updateGoalEmbedding,
  updateGoalMetadata,
  searchRelevantGoals,
  deleteGoal,
  getGoalsByCategory,
  getGoalCategories,
} from "../database/goals.js";

const USER = 7;
let db: BotDatabase;
beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("createGoal", () => {
  it("creates a goal with defaults and parsed fields", async () => {
    const g = await createGoal(db, USER, "Ship the bot");
    expect(g).not.toBeNull();
    expect(g!.title).toBe("Ship the bot");
    expect(g!.status).toBe("active");
    expect(g!.priority).toBe(5);
    expect(g!.telegram_user_id).toBe(USER);
  });

  it("stores description, priority, category, and embedding", async () => {
    const g = await createGoal(db, USER, "Learn SQL", "deeply", 9, "study", [1, 0]);
    expect(g!.description).toBe("deeply");
    expect(g!.priority).toBe(9);
    expect(g!.category).toBe("study");
    expect(g!.embedding).toEqual([1, 0]);
  });
});

describe("getGoals / getActiveGoals", () => {
  it("orders by priority descending", async () => {
    await createGoal(db, USER, "low", undefined, 2);
    await createGoal(db, USER, "high", undefined, 9);
    await createGoal(db, USER, "mid", undefined, 5);
    const goals = await getGoals(db, USER);
    expect(goals.map((g) => g.title)).toEqual(["high", "mid", "low"]);
  });

  it("filters to active goals only", async () => {
    const a = await createGoal(db, USER, "active one");
    const b = await createGoal(db, USER, "done one");
    await completeGoal(db, b!.id);
    const active = await getActiveGoals(db, USER);
    expect(active.map((g) => g.id)).toEqual([a!.id]);
  });

  it("scopes by user", async () => {
    await createGoal(db, USER, "mine");
    await createGoal(db, 99, "theirs");
    expect((await getGoals(db, USER))).toHaveLength(1);
  });
});

describe("status transitions", () => {
  it("completeGoal sets status and completed_at", async () => {
    const g = await createGoal(db, USER, "finish");
    expect(await completeGoal(db, g!.id)).toBe(true);
    const [updated] = await getGoals(db, USER, "completed");
    expect(updated!.status).toBe("completed");
    expect(updated!.completed_at).toBeTruthy();
  });

  it("archiveGoal sets archived status", async () => {
    const g = await createGoal(db, USER, "old");
    expect(await archiveGoal(db, g!.id)).toBe(true);
    const [updated] = await getGoals(db, USER, "archived");
    expect(updated!.status).toBe("archived");
  });

  it("updateGoalStatus returns false for unknown id", async () => {
    expect(await updateGoalStatus(db, "nope", "completed")).toBe(false);
  });
});

describe("searchRelevantGoals", () => {
  it("returns only active goals above the threshold, by similarity", async () => {
    const match = await createGoal(db, USER, "cats", undefined, 5, undefined, [1, 0, 0]);
    await createGoal(db, USER, "taxes", undefined, 5, undefined, [0, 1, 0]);
    const archived = await createGoal(db, USER, "old cats", undefined, 5, undefined, [1, 0, 0]);
    await archiveGoal(db, archived!.id);

    const results = await searchRelevantGoals(db, [0.95, 0.05, 0], USER, 5, 0.5);
    expect(results.map((r) => r.id)).toEqual([match!.id]);
    expect(results[0]!.similarity).toBeGreaterThan(0.9);
  });

  it("can update a goal embedding then find it", async () => {
    const g = await createGoal(db, USER, "late");
    await updateGoalEmbedding(db, g!.id, [0, 1]);
    const results = await searchRelevantGoals(db, [0, 1], USER, 5, 0.5);
    expect(results[0]!.id).toBe(g!.id);
  });
});

describe("updateGoalMetadata + getAllActiveGoals", () => {
  it("merges metadata onto a goal and round-trips it", async () => {
    const g = await createGoal(db, USER, "deadline goal");
    expect(await updateGoalMetadata(db, g!.id, { deadline: "2026-06-01T10:00:00Z" })).toBe(true);
    const [updated] = await getGoals(db, USER);
    expect(updated!.metadata).toEqual({ deadline: "2026-06-01T10:00:00Z" });
  });

  it("getAllActiveGoals returns active goals across users with parsed metadata", async () => {
    const a = await createGoal(db, USER, "mine");
    await updateGoalMetadata(db, a!.id, { deadline: "x" });
    const b = await createGoal(db, 555, "theirs");
    const done = await createGoal(db, USER, "done");
    await completeGoal(db, done!.id);

    const all = await getAllActiveGoals(db);
    const titles = all.map((g) => g.title).sort();
    expect(titles).toEqual(["mine", "theirs"]);
    const mine = all.find((g) => g.title === "mine");
    expect(mine!.metadata).toEqual({ deadline: "x" });
  });
});

describe("delete + categories", () => {
  it("deletes a goal", async () => {
    const g = await createGoal(db, USER, "temp");
    expect(await deleteGoal(db, g!.id)).toBe(true);
    expect(await getGoals(db, USER)).toHaveLength(0);
  });

  it("gets goals by category and lists unique categories", async () => {
    await createGoal(db, USER, "a", undefined, 5, "work");
    await createGoal(db, USER, "b", undefined, 8, "work");
    await createGoal(db, USER, "c", undefined, 5, "home");
    await createGoal(db, USER, "d"); // no category

    const work = await getGoalsByCategory(db, USER, "work");
    expect(work.map((g) => g.title)).toEqual(["b", "a"]); // priority desc

    const cats = (await getGoalCategories(db, USER)).sort();
    expect(cats).toEqual(["home", "work"]);
  });
});
