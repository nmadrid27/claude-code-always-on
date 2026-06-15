/**
 * Goals Repository
 *
 * Manages user goals with semantic search. Backed by local SQLite (bun:sqlite).
 * Relevance search is computed in JS via cosine similarity over stored
 * embeddings (replaces the former pgvector RPC).
 */

import type { BotDatabase } from "./sqlite.js";
import type { GoalRow, RelevantGoal } from "./supabase.js";
import { cosineSimilarity } from "../services/embeddings.js";
import {
  newId,
  nowIso,
  parseJson,
  parseVector,
  serializeJson,
  serializeVector,
} from "./util.js";

interface GoalDbRow {
  id: string;
  telegram_user_id: number;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  priority: number;
  category: string | null;
  embedding: string | null;
  metadata: string;
}

function mapGoal(r: GoalDbRow): GoalRow {
  return {
    id: r.id,
    telegram_user_id: r.telegram_user_id,
    title: r.title,
    description: r.description ?? undefined,
    status: r.status as GoalRow["status"],
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at ?? undefined,
    priority: r.priority,
    category: r.category ?? undefined,
    embedding: parseVector(r.embedding),
    metadata: parseJson(r.metadata),
  };
}

function getGoalById(db: BotDatabase, id: string): GoalRow | null {
  const row = db
    .query("SELECT * FROM goals WHERE id = ?")
    .get(id) as GoalDbRow | null;
  return row ? mapGoal(row) : null;
}

/**
 * Creates a new goal for a user.
 */
export async function createGoal(
  db: BotDatabase,
  userId: number,
  title: string,
  description?: string,
  priority = 5,
  category?: string,
  embedding?: number[],
): Promise<GoalRow | null> {
  try {
    const id = newId();
    const ts = nowIso();
    db.query(
      `INSERT INTO goals
        (id, telegram_user_id, title, description, status, created_at, updated_at, priority, category, embedding, metadata)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, '{}')`,
    ).run(
      id,
      userId,
      title,
      description ?? null,
      ts,
      ts,
      priority,
      category ?? null,
      serializeVector(embedding),
    );
    return getGoalById(db, id);
  } catch (error) {
    console.error("[db:goals] Failed to create goal:", error);
    return null;
  }
}

/**
 * Retrieves goals for a user, optionally filtered by status, priority desc.
 */
export async function getGoals(
  db: BotDatabase,
  userId: number,
  status?: "active" | "completed" | "archived",
): Promise<GoalRow[]> {
  try {
    const rows = status
      ? (db
          .query(
            "SELECT * FROM goals WHERE telegram_user_id = ? AND status = ? ORDER BY priority DESC, rowid ASC",
          )
          .all(userId, status) as GoalDbRow[])
      : (db
          .query(
            "SELECT * FROM goals WHERE telegram_user_id = ? ORDER BY priority DESC, rowid ASC",
          )
          .all(userId) as GoalDbRow[]);
    return rows.map(mapGoal);
  } catch (error) {
    console.error("[db:goals] Failed to retrieve goals:", error);
    return [];
  }
}

/**
 * Gets active goals for a user.
 */
export async function getActiveGoals(
  db: BotDatabase,
  userId: number,
): Promise<GoalRow[]> {
  return getGoals(db, userId, "active");
}

/**
 * Gets active goals across all users (used by the deadline checker).
 */
export async function getAllActiveGoals(db: BotDatabase): Promise<GoalRow[]> {
  try {
    const rows = db
      .query(
        "SELECT * FROM goals WHERE status = 'active' ORDER BY priority DESC, rowid ASC",
      )
      .all() as GoalDbRow[];
    return rows.map(mapGoal);
  } catch (error) {
    console.error("[db:goals] Failed to retrieve all active goals:", error);
    return [];
  }
}

/**
 * Replaces a goal's metadata object.
 */
export async function updateGoalMetadata(
  db: BotDatabase,
  goalId: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  try {
    const result = db
      .query("UPDATE goals SET metadata = ?, updated_at = ? WHERE id = ?")
      .run(serializeJson(metadata), nowIso(), goalId);
    return result.changes > 0;
  } catch (error) {
    console.error("[db:goals] Failed to update metadata:", error);
    return false;
  }
}

/**
 * Updates a goal's status. Sets completed_at when completing.
 */
export async function updateGoalStatus(
  db: BotDatabase,
  goalId: string,
  status: "active" | "completed" | "archived",
): Promise<boolean> {
  try {
    const ts = nowIso();
    const result =
      status === "completed"
        ? db
            .query(
              "UPDATE goals SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?",
            )
            .run(status, ts, ts, goalId)
        : db
            .query("UPDATE goals SET status = ?, updated_at = ? WHERE id = ?")
            .run(status, ts, goalId);
    return result.changes > 0;
  } catch (error) {
    console.error("[db:goals] Failed to update status:", error);
    return false;
  }
}

/**
 * Marks a goal as completed.
 */
export async function completeGoal(
  db: BotDatabase,
  goalId: string,
): Promise<boolean> {
  return updateGoalStatus(db, goalId, "completed");
}

/**
 * Archives a goal.
 */
export async function archiveGoal(
  db: BotDatabase,
  goalId: string,
): Promise<boolean> {
  return updateGoalStatus(db, goalId, "archived");
}

/**
 * Updates a goal's embedding.
 */
export async function updateGoalEmbedding(
  db: BotDatabase,
  goalId: string,
  embedding: number[],
): Promise<boolean> {
  try {
    const result = db
      .query("UPDATE goals SET embedding = ?, updated_at = ? WHERE id = ?")
      .run(serializeVector(embedding), nowIso(), goalId);
    return result.changes > 0;
  } catch (error) {
    console.error("[db:goals] Failed to update embedding:", error);
    return false;
  }
}

/**
 * Finds active goals relevant to a query embedding (JS cosine similarity).
 */
export async function searchRelevantGoals(
  db: BotDatabase,
  queryEmbedding: number[],
  userId: number,
  limit = 5,
  threshold = 0.6,
): Promise<RelevantGoal[]> {
  try {
    const rows = db
      .query(
        `SELECT id, title, description, status, embedding
         FROM goals
         WHERE telegram_user_id = ? AND status = 'active' AND embedding IS NOT NULL`,
      )
      .all(userId) as Array<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      embedding: string | null;
    }>;

    const scored: RelevantGoal[] = [];
    for (const r of rows) {
      const emb = parseVector(r.embedding);
      if (!emb || emb.length !== queryEmbedding.length) continue;
      const similarity = cosineSimilarity(queryEmbedding, emb);
      if (similarity >= threshold) {
        scored.push({
          id: r.id,
          title: r.title,
          description: r.description ?? undefined,
          status: r.status,
          similarity,
        });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  } catch (error) {
    console.error("[db:goals] Semantic search failed:", error);
    return [];
  }
}

/**
 * Deletes a goal.
 */
export async function deleteGoal(
  db: BotDatabase,
  goalId: string,
): Promise<boolean> {
  try {
    const result = db.query("DELETE FROM goals WHERE id = ?").run(goalId);
    return result.changes > 0;
  } catch (error) {
    console.error("[db:goals] Failed to delete goal:", error);
    return false;
  }
}

/**
 * Gets goals by category (priority desc).
 */
export async function getGoalsByCategory(
  db: BotDatabase,
  userId: number,
  category: string,
): Promise<GoalRow[]> {
  try {
    const rows = db
      .query(
        "SELECT * FROM goals WHERE telegram_user_id = ? AND category = ? ORDER BY priority DESC, rowid ASC",
      )
      .all(userId, category) as GoalDbRow[];
    return rows.map(mapGoal);
  } catch (error) {
    console.error("[db:goals] Failed to get goals by category:", error);
    return [];
  }
}

/**
 * Gets all unique category names for a user's goals.
 */
export async function getGoalCategories(
  db: BotDatabase,
  userId: number,
): Promise<string[]> {
  try {
    const rows = db
      .query(
        "SELECT DISTINCT category FROM goals WHERE telegram_user_id = ? AND category IS NOT NULL",
      )
      .all(userId) as Array<{ category: string }>;
    return rows.map((r) => r.category);
  } catch (error) {
    console.error("[db:goals] Failed to get categories:", error);
    return [];
  }
}
