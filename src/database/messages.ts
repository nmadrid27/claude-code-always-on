/**
 * Message Repository
 *
 * Stores and retrieves messages with semantic search. Backed by local SQLite
 * (bun:sqlite). Similarity search is computed in JS via cosine similarity over
 * stored embedding vectors (replaces the former pgvector RPCs).
 */

import type { BotDatabase } from "./sqlite.js";
import type { MessageRow, SimilarMessage } from "./supabase.js";
import { cosineSimilarity } from "../services/embeddings.js";
import {
  newId,
  nowIso,
  parseJson,
  parseVector,
  serializeJson,
  serializeVector,
} from "./util.js";

/**
 * Result type for paginated message queries
 */
export interface MessagePaginationResult {
  messages: MessageRow[];
  hasMore: boolean;
  totalCount?: number;
}

interface MessageDbRow {
  id: string;
  telegram_user_id: number;
  telegram_message_id: number | null;
  role: string;
  content: string;
  created_at: string;
  updated_at: string;
  embedding: string | null;
  metadata: string;
}

function mapMessage(r: MessageDbRow): MessageRow {
  return {
    id: r.id,
    telegram_user_id: r.telegram_user_id,
    telegram_message_id: r.telegram_message_id ?? undefined,
    role: r.role as MessageRow["role"],
    content: r.content,
    created_at: r.created_at,
    updated_at: r.updated_at,
    embedding: parseVector(r.embedding),
    metadata: parseJson(r.metadata),
  };
}

function getMessageById(db: BotDatabase, id: string): MessageRow | null {
  const row = db
    .query("SELECT * FROM messages WHERE id = ?")
    .get(id) as MessageDbRow | null;
  return row ? mapMessage(row) : null;
}

/**
 * Stores a new message in the database.
 */
export async function storeMessage(
  db: BotDatabase,
  userId: number,
  role: "user" | "assistant" | "system",
  content: string,
  embedding?: number[],
  metadata?: Record<string, unknown>,
  telegramMessageId?: number,
): Promise<MessageRow | null> {
  try {
    const id = newId();
    const ts = nowIso();
    db.query(
      `INSERT INTO messages
        (id, telegram_user_id, telegram_message_id, role, content, created_at, updated_at, embedding, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      telegramMessageId ?? null,
      role,
      content,
      ts,
      ts,
      serializeVector(embedding),
      serializeJson(metadata),
    );
    return getMessageById(db, id);
  } catch (error) {
    console.error("[db:messages] Failed to store message:", error);
    return null;
  }
}

/**
 * Stores multiple messages in a single transaction.
 */
export async function storeMessages(
  db: BotDatabase,
  messages: Array<{
    userId: number;
    role: "user" | "assistant" | "system";
    content: string;
    embedding?: number[];
    metadata?: Record<string, unknown>;
    telegramMessageId?: number;
  }>,
): Promise<MessageRow[]> {
  if (messages.length === 0) {
    return [];
  }

  try {
    const ids: string[] = [];
    const insert = db.query(
      `INSERT INTO messages
        (id, telegram_user_id, telegram_message_id, role, content, created_at, updated_at, embedding, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      for (const m of messages) {
        const id = newId();
        const ts = nowIso();
        insert.run(
          id,
          m.userId,
          m.telegramMessageId ?? null,
          m.role,
          m.content,
          ts,
          ts,
          serializeVector(m.embedding),
          serializeJson(m.metadata),
        );
        ids.push(id);
      }
    });
    tx();
    return ids
      .map((id) => getMessageById(db, id))
      .filter((m): m is MessageRow => m !== null);
  } catch (error) {
    console.error("[db:messages] Failed to store messages batch:", error);
    return [];
  }
}

/**
 * Retrieves recent messages for a user (newest first), with pagination.
 */
export async function getRecentMessages(
  db: BotDatabase,
  userId: number,
  limit = 50,
  offset = 0,
): Promise<MessagePaginationResult> {
  try {
    const countRow = db
      .query("SELECT COUNT(*) AS c FROM messages WHERE telegram_user_id = ?")
      .get(userId) as { c: number };

    const rows = db
      .query(
        `SELECT * FROM messages
         WHERE telegram_user_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as MessageDbRow[];

    return {
      messages: rows.map(mapMessage),
      hasMore: rows.length === limit,
      totalCount: countRow.c,
    };
  } catch (error) {
    console.error("[db:messages] Failed to retrieve messages:", error);
    return { messages: [], hasMore: false };
  }
}

/**
 * Retrieves conversation history within a date range (chronological order).
 */
export async function getMessagesInRange(
  db: BotDatabase,
  userId: number,
  startDate: Date,
  endDate: Date,
): Promise<MessageRow[]> {
  try {
    const rows = db
      .query(
        `SELECT * FROM messages
         WHERE telegram_user_id = ? AND created_at >= ? AND created_at <= ?
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all(userId, startDate.toISOString(), endDate.toISOString()) as MessageDbRow[];
    return rows.map(mapMessage);
  } catch (error) {
    console.error("[db:messages] Failed to retrieve messages in range:", error);
    return [];
  }
}

/**
 * Updates a message's embedding vector.
 */
export async function updateMessageEmbedding(
  db: BotDatabase,
  messageId: string,
  embedding: number[],
): Promise<boolean> {
  try {
    const result = db
      .query("UPDATE messages SET embedding = ?, updated_at = ? WHERE id = ?")
      .run(serializeVector(embedding), nowIso(), messageId);
    return result.changes > 0;
  } catch (error) {
    console.error("[db:messages] Failed to update embedding:", error);
    return false;
  }
}

/**
 * Finds messages most similar to a query embedding using JS cosine similarity.
 */
export async function searchSimilarMessages(
  db: BotDatabase,
  queryEmbedding: number[],
  userId?: number,
  limit = 10,
  threshold = 0.7,
): Promise<SimilarMessage[]> {
  try {
    const rows = db
      .query(
        `SELECT id, telegram_user_id, role, content, embedding
         FROM messages
         WHERE embedding IS NOT NULL
         ${userId != null ? "AND telegram_user_id = ?" : ""}`,
      )
      .all(...(userId != null ? [userId] : [])) as Array<{
      id: string;
      telegram_user_id: number;
      role: string;
      content: string;
      embedding: string | null;
    }>;

    const scored: SimilarMessage[] = [];
    for (const r of rows) {
      const emb = parseVector(r.embedding);
      if (!emb || emb.length !== queryEmbedding.length) continue;
      const similarity = cosineSimilarity(queryEmbedding, emb);
      if (similarity >= threshold) {
        scored.push({
          id: r.id,
          telegram_user_id: r.telegram_user_id,
          role: r.role,
          content: r.content,
          similarity,
        });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  } catch (error) {
    console.error("[db:messages] Semantic search failed:", error);
    return [];
  }
}

/**
 * Deletes a message by ID.
 */
export async function deleteMessage(
  db: BotDatabase,
  messageId: string,
): Promise<boolean> {
  try {
    const result = db
      .query("DELETE FROM messages WHERE id = ?")
      .run(messageId);
    return result.changes > 0;
  } catch (error) {
    console.error("[db:messages] Failed to delete message:", error);
    return false;
  }
}

/**
 * Deletes all messages for a user. Returns the number deleted.
 */
export async function deleteAllUserMessages(
  db: BotDatabase,
  userId: number,
): Promise<number> {
  try {
    const result = db
      .query("DELETE FROM messages WHERE telegram_user_id = ?")
      .run(userId);
    return result.changes;
  } catch (error) {
    console.error("[db:messages] Failed to delete user messages:", error);
    return 0;
  }
}

/**
 * Gets message statistics for a user.
 */
export async function getMessageStats(
  db: BotDatabase,
  userId: number,
): Promise<{
  total: number;
  user: number;
  assistant: number;
  system: number;
  withEmbeddings: number;
}> {
  try {
    const row = db
      .query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user,
           SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistant,
           SUM(CASE WHEN role = 'system' THEN 1 ELSE 0 END) AS system,
           SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS withEmbeddings
         FROM messages WHERE telegram_user_id = ?`,
      )
      .get(userId) as {
      total: number;
      user: number | null;
      assistant: number | null;
      system: number | null;
      withEmbeddings: number | null;
    };

    return {
      total: row.total,
      user: row.user ?? 0,
      assistant: row.assistant ?? 0,
      system: row.system ?? 0,
      withEmbeddings: row.withEmbeddings ?? 0,
    };
  } catch (error) {
    console.error("[db:messages] Failed to get stats:", error);
    return { total: 0, user: 0, assistant: 0, system: 0, withEmbeddings: 0 };
  }
}

/**
 * Retrieves recent conversation context formatted for LLM prompting.
 */
export async function getConversationContext(
  db: BotDatabase,
  userId: number,
  maxMessages = 20,
): Promise<string> {
  const { messages } = await getRecentMessages(db, userId, maxMessages);

  if (messages.length === 0) {
    return "";
  }

  // Reverse to get chronological order
  const chronological = [...messages].reverse();

  return chronological
    .map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`)
    .join("\n\n");
}
