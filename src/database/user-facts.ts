/**
 * User Facts Repository
 *
 * Stores facts about users for personalization. Backed by local SQLite
 * (bun:sqlite). Relevance search is computed in JS via cosine similarity over
 * stored embeddings (replaces the former pgvector RPC).
 */

import type { BotDatabase } from "./sqlite.js";
import type { UserFactRow, RelevantFact } from "./supabase.js";
import { cosineSimilarity } from "../services/embeddings.js";
import { newId, nowIso, parseVector, serializeVector } from "./util.js";

/**
 * Fact types for categorization
 */
export type FactType =
  | "preference"
  | "context"
  | "relationship"
  | "habit"
  | "skill"
  | "interest"
  | "constraint"
  | "other";

interface FactDbRow {
  id: string;
  telegram_user_id: number;
  fact_type: string;
  fact_text: string;
  confidence: number;
  source: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
  access_count: number;
  embedding: string | null;
}

function mapFact(r: FactDbRow): UserFactRow {
  return {
    id: r.id,
    telegram_user_id: r.telegram_user_id,
    fact_type: r.fact_type,
    fact_text: r.fact_text,
    confidence: r.confidence,
    source: r.source ?? undefined,
    source_message_id: r.source_message_id ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_accessed_at: r.last_accessed_at,
    access_count: r.access_count,
    embedding: parseVector(r.embedding),
  };
}

function clampConfidence(c: number): number {
  return Math.max(1, Math.min(10, Math.round(c)));
}

/**
 * Creates or updates a user fact (unique on user_id + type + text).
 */
export async function upsertUserFact(
  db: BotDatabase,
  userId: number,
  factType: FactType,
  factText: string,
  confidence = 5,
  source?: string,
  embedding?: number[],
): Promise<UserFactRow | null> {
  try {
    const ts = nowIso();
    db.query(
      `INSERT INTO user_facts
        (id, telegram_user_id, fact_type, fact_text, confidence, source, embedding,
         created_at, updated_at, last_accessed_at, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT (telegram_user_id, fact_type, fact_text)
       DO UPDATE SET
         confidence = excluded.confidence,
         source = excluded.source,
         embedding = excluded.embedding,
         last_accessed_at = excluded.last_accessed_at,
         updated_at = excluded.updated_at`,
    ).run(
      newId(),
      userId,
      factType,
      factText,
      clampConfidence(confidence),
      source ?? null,
      serializeVector(embedding),
      ts,
      ts,
      ts,
    );

    const row = db
      .query(
        "SELECT * FROM user_facts WHERE telegram_user_id = ? AND fact_type = ? AND fact_text = ?",
      )
      .get(userId, factType, factText) as FactDbRow | null;
    return row ? mapFact(row) : null;
  } catch (error) {
    console.error("[db:facts] Failed to upsert fact:", error);
    return null;
  }
}

/**
 * Retrieves facts for a user, optionally filtered by type, ordered by
 * confidence desc. Increments the access count of returned rows.
 */
export async function getUserFacts(
  db: BotDatabase,
  userId: number,
  factType?: FactType,
  minConfidence = 1,
): Promise<UserFactRow[]> {
  try {
    const rows = factType
      ? (db
          .query(
            "SELECT * FROM user_facts WHERE telegram_user_id = ? AND confidence >= ? AND fact_type = ? ORDER BY confidence DESC, rowid ASC",
          )
          .all(userId, minConfidence, factType) as FactDbRow[])
      : (db
          .query(
            "SELECT * FROM user_facts WHERE telegram_user_id = ? AND confidence >= ? ORDER BY confidence DESC, rowid ASC",
          )
          .all(userId, minConfidence) as FactDbRow[]);

    if (rows.length > 0) {
      const ts = nowIso();
      const bump = db.query(
        "UPDATE user_facts SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?",
      );
      const tx = db.transaction(() => {
        for (const r of rows) bump.run(ts, r.id);
      });
      tx();
    }

    return rows.map(mapFact);
  } catch (error) {
    console.error("[db:facts] Failed to retrieve facts:", error);
    return [];
  }
}

/**
 * Gets facts of a specific type for a user.
 */
export async function getFactsByType(
  db: BotDatabase,
  userId: number,
  factType: FactType,
): Promise<UserFactRow[]> {
  return getUserFacts(db, userId, factType);
}

/**
 * Finds facts relevant to a query embedding (JS cosine similarity).
 */
export async function searchRelevantFacts(
  db: BotDatabase,
  queryEmbedding: number[],
  userId: number,
  limit = 10,
  threshold = 0.65,
): Promise<RelevantFact[]> {
  try {
    const rows = db
      .query(
        `SELECT id, fact_type, fact_text, confidence, embedding
         FROM user_facts
         WHERE telegram_user_id = ? AND embedding IS NOT NULL`,
      )
      .all(userId) as Array<{
      id: string;
      fact_type: string;
      fact_text: string;
      confidence: number;
      embedding: string | null;
    }>;

    const scored: RelevantFact[] = [];
    for (const r of rows) {
      const emb = parseVector(r.embedding);
      if (!emb || emb.length !== queryEmbedding.length) continue;
      const similarity = cosineSimilarity(queryEmbedding, emb);
      if (similarity >= threshold) {
        scored.push({
          id: r.id,
          fact_type: r.fact_type,
          fact_text: r.fact_text,
          confidence: r.confidence,
          similarity,
        });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  } catch (error) {
    console.error("[db:facts] Semantic search failed:", error);
    return [];
  }
}

/**
 * Updates a fact's confidence score (clamped 1-10).
 */
export async function updateFactConfidence(
  db: BotDatabase,
  factId: string,
  confidence: number,
): Promise<boolean> {
  try {
    const result = db
      .query("UPDATE user_facts SET confidence = ?, updated_at = ? WHERE id = ?")
      .run(clampConfidence(confidence), nowIso(), factId);
    return result.changes > 0;
  } catch (error) {
    console.error("[db:facts] Failed to update confidence:", error);
    return false;
  }
}

/**
 * Updates a fact's embedding.
 */
export async function updateFactEmbedding(
  db: BotDatabase,
  factId: string,
  embedding: number[],
): Promise<boolean> {
  try {
    const result = db
      .query("UPDATE user_facts SET embedding = ?, updated_at = ? WHERE id = ?")
      .run(serializeVector(embedding), nowIso(), factId);
    return result.changes > 0;
  } catch (error) {
    console.error("[db:facts] Failed to update embedding:", error);
    return false;
  }
}

/**
 * Deletes a fact.
 */
export async function deleteFact(
  db: BotDatabase,
  factId: string,
): Promise<boolean> {
  try {
    const result = db.query("DELETE FROM user_facts WHERE id = ?").run(factId);
    return result.changes > 0;
  } catch (error) {
    console.error("[db:facts] Failed to delete fact:", error);
    return false;
  }
}

/**
 * Deletes all facts of a specific type for a user. Returns the count deleted.
 */
export async function deleteFactsByType(
  db: BotDatabase,
  userId: number,
  factType: FactType,
): Promise<number> {
  try {
    const result = db
      .query(
        "DELETE FROM user_facts WHERE telegram_user_id = ? AND fact_type = ?",
      )
      .run(userId, factType);
    return result.changes;
  } catch (error) {
    console.error("[db:facts] Failed to delete facts by type:", error);
    return 0;
  }
}

/**
 * Gets a formatted summary of a user's facts for LLM prompting.
 */
export async function getFactsSummary(
  db: BotDatabase,
  userId: number,
  minConfidence = 5,
): Promise<string> {
  const facts = await getUserFacts(db, userId, undefined, minConfidence);

  if (facts.length === 0) {
    return "";
  }

  // Group by type
  const grouped = new Map<FactType, UserFactRow[]>();
  for (const fact of facts) {
    const type = fact.fact_type as FactType;
    if (!grouped.has(type)) {
      grouped.set(type, []);
    }
    grouped.get(type)!.push(fact);
  }

  // Format as structured text
  const sections: string[] = [];
  for (const [type, typeFacts] of grouped) {
    const factStrings = typeFacts.map(
      (f) => `- ${f.fact_text} (confidence: ${f.confidence})`,
    );
    sections.push(
      `**${type.charAt(0).toUpperCase() + type.slice(1)}s:**\n${factStrings.join("\n")}`,
    );
  }

  return `## User Facts\n\n${sections.join("\n\n")}`;
}

/**
 * Infers and stores facts from a conversation. Returns the number stored.
 */
export async function storeInferredFacts(
  db: BotDatabase,
  userId: number,
  facts: Array<{
    type: FactType;
    text: string;
    confidence: number;
  }>,
): Promise<number> {
  let stored = 0;

  for (const fact of facts) {
    const result = await upsertUserFact(
      db,
      userId,
      fact.type,
      fact.text,
      fact.confidence,
      "inference",
    );
    if (result) {
      stored++;
    }
  }

  return stored;
}
