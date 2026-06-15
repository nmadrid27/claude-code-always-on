// src/__tests__/messages.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { openDatabase } from "../database/sqlite.js";
import type { BotDatabase } from "../database/sqlite.js";
import {
  storeMessage,
  storeMessages,
  getRecentMessages,
  getMessagesInRange,
  updateMessageEmbedding,
  searchSimilarMessages,
  deleteMessage,
  deleteAllUserMessages,
  getMessageStats,
  getConversationContext,
} from "../database/messages.js";

const USER = 4242;

let db: BotDatabase;
beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("storeMessage + getRecentMessages", () => {
  it("stores a message and returns it with parsed fields", async () => {
    const row = await storeMessage(db, USER, "user", "hello", [0.1, 0.2], {
      foo: "bar",
    });
    expect(row).not.toBeNull();
    expect(row!.id).toBeTruthy();
    expect(row!.telegram_user_id).toBe(USER);
    expect(row!.role).toBe("user");
    expect(row!.content).toBe("hello");
    expect(row!.embedding).toEqual([0.1, 0.2]);
    expect(row!.metadata).toEqual({ foo: "bar" });
    expect(row!.created_at).toContain("T"); // ISO format
  });

  it("returns most-recent-first, tie-breaking on insertion order", async () => {
    await storeMessage(db, USER, "user", "first");
    await storeMessage(db, USER, "assistant", "second");
    await storeMessage(db, USER, "user", "third");

    const result = await getRecentMessages(db, USER, 50);
    expect(result.messages.map((m) => m.content)).toEqual([
      "third",
      "second",
      "first",
    ]);
    expect(result.totalCount).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  it("scopes messages by user", async () => {
    await storeMessage(db, USER, "user", "mine");
    await storeMessage(db, 9999, "user", "theirs");
    const result = await getRecentMessages(db, USER, 50);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.content).toBe("mine");
  });

  it("reports hasMore when the limit is filled", async () => {
    await storeMessages(db, [
      { userId: USER, role: "user", content: "a" },
      { userId: USER, role: "user", content: "b" },
      { userId: USER, role: "user", content: "c" },
    ]);
    const page = await getRecentMessages(db, USER, 2);
    expect(page.messages).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.totalCount).toBe(3);
  });
});

describe("storeMessages batch", () => {
  it("inserts all rows and returns them", async () => {
    const rows = await storeMessages(db, [
      { userId: USER, role: "user", content: "one" },
      { userId: USER, role: "assistant", content: "two", embedding: [1, 0] },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.embedding).toEqual([1, 0]);
  });

  it("returns [] for empty input", async () => {
    expect(await storeMessages(db, [])).toEqual([]);
  });
});

describe("getMessagesInRange", () => {
  it("returns messages within the date range, chronological", async () => {
    const a = await storeMessage(db, USER, "user", "old");
    const b = await storeMessage(db, USER, "user", "new");
    // Both are 'now'; range from epoch to far future should include both in order.
    const rows = await getMessagesInRange(
      db,
      USER,
      new Date("2000-01-01"),
      new Date("2999-01-01"),
    );
    expect(rows.map((r) => r.content)).toEqual(["old", "new"]);
    expect(a!.id).not.toBe(b!.id);
  });
});

describe("updateMessageEmbedding + searchSimilarMessages", () => {
  it("finds the most semantically similar message via JS cosine", async () => {
    const target = await storeMessage(db, USER, "user", "cats are great", [1, 0, 0]);
    await storeMessage(db, USER, "user", "tax forms", [0, 1, 0]);
    await storeMessage(db, USER, "user", "no embedding here"); // skipped (null)

    const results = await searchSimilarMessages(db, [0.9, 0.1, 0], USER, 5, 0.5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.content).toBe("cats are great");
    expect(results[0]!.id).toBe(target!.id);
    expect(results[0]!.similarity).toBeGreaterThan(0.9);
  });

  it("respects the similarity threshold", async () => {
    await storeMessage(db, USER, "user", "orthogonal", [0, 1]);
    const results = await searchSimilarMessages(db, [1, 0], USER, 5, 0.5);
    expect(results).toHaveLength(0);
  });

  it("can update an embedding after the fact", async () => {
    const row = await storeMessage(db, USER, "user", "late embed");
    const ok = await updateMessageEmbedding(db, row!.id, [1, 0]);
    expect(ok).toBe(true);
    const results = await searchSimilarMessages(db, [1, 0], USER, 5, 0.5);
    expect(results[0]!.content).toBe("late embed");
  });
});

describe("delete + stats + context", () => {
  it("deletes a single message", async () => {
    const row = await storeMessage(db, USER, "user", "bye");
    expect(await deleteMessage(db, row!.id)).toBe(true);
    expect((await getRecentMessages(db, USER, 50)).messages).toHaveLength(0);
  });

  it("deletes all user messages and returns the count", async () => {
    await storeMessages(db, [
      { userId: USER, role: "user", content: "a" },
      { userId: USER, role: "user", content: "b" },
    ]);
    expect(await deleteAllUserMessages(db, USER)).toBe(2);
  });

  it("computes message stats", async () => {
    await storeMessage(db, USER, "user", "u1", [1]);
    await storeMessage(db, USER, "assistant", "a1");
    await storeMessage(db, USER, "system", "s1");
    const stats = await getMessageStats(db, USER);
    expect(stats).toEqual({
      total: 3,
      user: 1,
      assistant: 1,
      system: 1,
      withEmbeddings: 1,
    });
  });

  it("formats conversation context chronologically", async () => {
    await storeMessage(db, USER, "user", "hi");
    await storeMessage(db, USER, "assistant", "hello");
    const ctx = await getConversationContext(db, USER, 20);
    expect(ctx).toBe("<user>\nhi\n</user>\n\n<assistant>\nhello\n</assistant>");
  });

  it("returns empty string when no messages", async () => {
    expect(await getConversationContext(db, USER, 20)).toBe("");
  });
});
