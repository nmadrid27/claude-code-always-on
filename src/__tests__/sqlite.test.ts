// src/__tests__/sqlite.test.ts
import { describe, it, expect } from "bun:test";
import { openDatabase } from "../database/sqlite.js";

describe("openDatabase", () => {
  it("creates the four core tables", () => {
    const db = openDatabase(":memory:");
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toContain("messages");
    expect(tables).toContain("goals");
    expect(tables).toContain("user_facts");
    expect(tables).toContain("conversation_contexts");
    db.close();
  });

  it("round-trips a raw message row", () => {
    const db = openDatabase(":memory:");
    db.query(
      "INSERT INTO messages (id, telegram_user_id, role, content, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    ).run("id1", 123, "user", "hi", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");

    const row = db.query("SELECT * FROM messages WHERE id = ?").get("id1") as {
      content: string;
      telegram_user_id: number;
      metadata: string;
    };

    expect(row.content).toBe("hi");
    expect(row.telegram_user_id).toBe(123);
    expect(row.metadata).toBe("{}"); // default applied
    db.close();
  });

  it("applies durability/locking PRAGMAs for the long-running process", () => {
    const db = openDatabase(":memory:");
    const busy = db.query("PRAGMA busy_timeout").get() as { timeout: number };
    expect(busy.timeout).toBe(5000);
    // synchronous: 1 === NORMAL
    const sync = db.query("PRAGMA synchronous").get() as { synchronous: number };
    expect(sync.synchronous).toBe(1);
    db.close();
  });

  it("enforces the role CHECK constraint", () => {
    const db = openDatabase(":memory:");
    expect(() =>
      db
        .query(
          "INSERT INTO messages (id, telegram_user_id, role, content, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        )
        .run("id2", 1, "invalid_role", "x", "t", "t"),
    ).toThrow();
    db.close();
  });
});
