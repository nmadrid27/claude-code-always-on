/**
 * Memory Service for Voice Context
 *
 * Provides context from the local SQLite memory for voice conversations.
 * Fetches recent messages, goals, and facts to inject into voice calls, and
 * persists messages/goals/facts created during a call.
 *
 * Backed by the same SQLite tables as the text bot (see src/database/*), so
 * voice and text share one memory. The public surface (fetchContext,
 * storeMessage, fetchRecentMessages, etc.) is preserved from the previous
 * Supabase-backed implementation.
 */

import { getDb, type BotDatabase } from "../database/sqlite.js";
import { EmbeddingsService } from "./embeddings.js";
import {
  storeMessage as dbStoreMessage,
  getRecentMessages as dbGetRecentMessages,
  updateMessageEmbedding as dbUpdateMessageEmbedding,
  searchSimilarMessages as dbSearchSimilarMessages,
} from "../database/messages.js";
import {
  createGoal as dbCreateGoal,
  getActiveGoals as dbGetActiveGoals,
  updateGoalStatus as dbUpdateGoalStatus,
  updateGoalMetadata as dbUpdateGoalMetadata,
} from "../database/goals.js";
import {
  upsertUserFact as dbUpsertUserFact,
  getUserFacts as dbGetUserFacts,
  type FactType,
} from "../database/user-facts.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Stored message (voice service shape)
 */
export interface StoredMessage {
  id: string;
  user_id: number;
  content: string;
  role: "user" | "assistant";
  created_at: string;
  metadata?: Record<string, unknown>;
}

/**
 * Memory context for voice calls
 */
export interface MemoryContext {
  recentMessages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: number;
  }>;
  goals: Array<{
    description: string;
    deadline: string | null;
    status: string;
  }>;
  facts: Array<{
    key: string;
    value: string;
    confidence: number;
  }>;
}

// ============================================================================
// MEMORY SERVICE CLASS
// ============================================================================

/**
 * Memory service for fetching/persisting context in the local SQLite database.
 */
export class MemoryService {
  private db: BotDatabase;
  private userId: number;
  private embeddingsService: EmbeddingsService | null;

  constructor(userId: number) {
    this.db = getDb();
    this.userId = userId;

    const voyageKey = process.env.VOYAGE_API_KEY;
    this.embeddingsService = voyageKey
      ? new EmbeddingsService({ apiKey: voyageKey })
      : null;
  }

  /**
   * Fetch full memory context for a voice call.
   */
  async fetchContext(messageCount: number = 15): Promise<MemoryContext> {
    const [recentMessages, goals, facts] = await Promise.all([
      this.fetchRecentMessages(messageCount),
      this.fetchActiveGoals(),
      this.fetchFacts(),
    ]);

    return { recentMessages, goals, facts };
  }

  /**
   * Fetch recent messages (newest first), excluding system messages.
   */
  async fetchRecentMessages(limit: number = 15): Promise<
    Array<{
      role: "user" | "assistant";
      content: string;
      timestamp: number;
    }>
  > {
    const { messages } = await dbGetRecentMessages(this.db, this.userId, limit);
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: new Date(m.created_at).getTime(),
      }));
  }

  /**
   * Fetch active goals. Deadlines (if any) are stored in goal metadata.
   */
  async fetchActiveGoals(): Promise<
    Array<{
      description: string;
      deadline: string | null;
      status: string;
    }>
  > {
    const goals = await dbGetActiveGoals(this.db, this.userId);
    return goals.map((g) => ({
      description: g.description ?? g.title,
      deadline: (g.metadata?.deadline as string | undefined) ?? null,
      status: g.status,
    }));
  }

  /**
   * Fetch user facts (key = fact_type, value = fact_text).
   */
  async fetchFacts(): Promise<
    Array<{
      key: string;
      value: string;
      confidence: number;
    }>
  > {
    const facts = await dbGetUserFacts(this.db, this.userId, undefined, 1);
    return facts.map((f) => ({
      key: f.fact_type,
      value: f.fact_text,
      confidence: f.confidence,
    }));
  }

  /**
   * Store a new message. Generates and stores an embedding asynchronously
   * (non-blocking) when an embeddings provider is configured.
   */
  async storeMessage(
    content: string,
    role: "user" | "assistant",
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const row = await dbStoreMessage(
      this.db,
      this.userId,
      role,
      content,
      undefined,
      metadata,
    );

    if (this.embeddingsService && row?.id) {
      this.generateAndStoreEmbedding(row.id, content).catch((err) => {
        console.warn("Failed to generate embedding for message:", err);
      });
    }
  }

  private async generateAndStoreEmbedding(
    messageId: string,
    content: string,
  ): Promise<void> {
    if (!this.embeddingsService) return;
    const embedding = await this.embeddingsService.embed(content);
    await dbUpdateMessageEmbedding(this.db, messageId, embedding);
  }

  /**
   * Create a new goal. An optional deadline is stored in goal metadata.
   */
  async createGoal(description: string, deadline?: Date): Promise<void> {
    const goal = await dbCreateGoal(this.db, this.userId, description);
    if (goal && deadline) {
      await dbUpdateGoalMetadata(this.db, goal.id, {
        deadline: deadline.toISOString(),
      });
    }
  }

  /**
   * Update a goal's status. "cancelled" maps to the schema's "archived".
   */
  async updateGoalStatus(
    goalId: string,
    status: "active" | "completed" | "cancelled",
  ): Promise<void> {
    const mapped = status === "cancelled" ? "archived" : status;
    await dbUpdateGoalStatus(this.db, goalId, mapped);
  }

  /**
   * Store or update a user fact. Voice confidence is 0-1; the schema stores
   * 1-10, so it is scaled and clamped.
   */
  async upsertFact(
    key: string,
    value: string,
    confidence: number = 0.8,
  ): Promise<void> {
    const scaled = Math.max(1, Math.min(10, Math.round(confidence * 10)));
    await dbUpsertUserFact(
      this.db,
      this.userId,
      key as FactType,
      value,
      scaled,
    );
  }

  /**
   * Semantic search over messages. Falls back to a substring match when no
   * embeddings provider is configured or the query embedding fails.
   */
  async semanticSearch(
    query: string,
    limit: number = 5,
  ): Promise<StoredMessage[]> {
    if (this.embeddingsService) {
      try {
        const queryEmbedding = await this.embeddingsService.embed(query);
        const hits = await dbSearchSimilarMessages(
          this.db,
          queryEmbedding,
          this.userId,
          limit,
          0.7,
        );
        if (hits.length > 0) {
          return hits.map((h) => ({
            id: h.id,
            user_id: h.telegram_user_id,
            content: h.content,
            role: h.role as "user" | "assistant",
            created_at: new Date().toISOString(),
          }));
        }
      } catch (err) {
        console.error("Embedding search failed, falling back to text:", err);
      }
    }

    // Fallback: substring search over recent messages
    const rows = this.db
      .query(
        `SELECT id, telegram_user_id, content, role, created_at, metadata
         FROM messages
         WHERE telegram_user_id = ? AND content LIKE ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(this.userId, `%${query}%`, limit) as Array<{
      id: string;
      telegram_user_id: number;
      content: string;
      role: string;
      created_at: string;
      metadata: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      user_id: r.telegram_user_id,
      content: r.content,
      role: r.role as "user" | "assistant",
      created_at: r.created_at,
    }));
  }

  /** Returns the underlying database handle (advanced usage). */
  getClient(): BotDatabase {
    return this.db;
  }

  /** Returns the user id this service is scoped to. */
  getUserId(): number {
    return this.userId;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a MemoryService instance for a user.
 */
export function createMemoryService(userId: number): MemoryService {
  return new MemoryService(userId);
}

/**
 * Create MemoryService instances for multiple users.
 */
export function createMemoryServices(
  userIds: number[],
): Map<number, MemoryService> {
  const services = new Map<number, MemoryService>();
  for (const userId of userIds) {
    services.set(userId, new MemoryService(userId));
  }
  return services;
}
