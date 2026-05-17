/**
 * Memory Service for Voice Context
 *
 * Provides context from Supabase memory for voice conversations.
 * Fetches recent messages, goals, and facts to inject into voice calls.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { EmbeddingsService } from "./embeddings.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Supabase configuration
 */
export interface SupabaseConfig {
  /** Supabase project URL */
  url: string;

  /** Supabase service role key (for server-side access) */
  serviceKey: string;
}

/**
 * Stored message from database
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
 * Goal from database
 */
export interface Goal {
  id: string;
  user_id: number;
  description: string;
  deadline: string | null;
  status: "active" | "completed" | "cancelled";
  created_at: string;
}

/**
 * User fact from database
 */
export interface Fact {
  id: string;
  user_id: number;
  key: string;
  value: string;
  confidence: number;
  updated_at: string;
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
 * Memory service for fetching context from Supabase
 */
export class MemoryService {
  private client: SupabaseClient;
  private userId: number;
  private embeddingsService: EmbeddingsService | null;

  constructor(config: SupabaseConfig, userId: number) {
    this.client = createClient(config.url, config.serviceKey);
    this.userId = userId;

    // Initialize embeddings service if VOYAGE_API_KEY is configured
    const openaiKey = process.env.VOYAGE_API_KEY;
    if (openaiKey) {
      this.embeddingsService = new EmbeddingsService({ apiKey: openaiKey });
    } else {
      this.embeddingsService = null;
    }
  }

  /**
   * Fetch full memory context for a voice call
   *
   * @param messageCount - Number of recent messages to fetch (default: 15)
   * @returns Complete memory context
   */
  async fetchContext(messageCount: number = 15): Promise<MemoryContext> {
    const [recentMessages, goals, facts] = await Promise.all([
      this.fetchRecentMessages(messageCount),
      this.fetchActiveGoals(),
      this.fetchFacts(),
    ]);

    return {
      recentMessages,
      goals,
      facts,
    };
  }

  /**
   * Fetch recent messages from the database
   *
   * @param limit - Maximum number of messages to fetch
   * @returns Array of recent messages
   */
  async fetchRecentMessages(limit: number = 15): Promise<
    Array<{
      role: "user" | "assistant";
      content: string;
      timestamp: number;
    }>
  > {
    const { data, error } = await this.client
      .from("messages")
      .select("content, role, created_at")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Error fetching recent messages:", error);
      return [];
    }

    return (data || []).map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
      timestamp: new Date(msg.created_at).getTime(),
    }));
  }

  /**
   * Fetch active goals from the database
   *
   * @returns Array of active goals
   */
  async fetchActiveGoals(): Promise<
    Array<{
      description: string;
      deadline: string | null;
      status: string;
    }>
  > {
    const { data, error } = await this.client
      .from("goals")
      .select("description, deadline, status")
      .eq("user_id", this.userId)
      .eq("status", "active")
      .order("deadline", { ascending: true, nullsFirst: false });

    if (error) {
      console.error("Error fetching goals:", error);
      return [];
    }

    return (data || []).map((goal) => ({
      description: goal.description,
      deadline: goal.deadline,
      status: goal.status,
    }));
  }

  /**
   * Fetch user facts from the database
   *
   * @returns Array of user facts
   */
  async fetchFacts(): Promise<
    Array<{
      key: string;
      value: string;
      confidence: number;
    }>
  > {
    const { data, error } = await this.client
      .from("facts")
      .select("key, value, confidence")
      .eq("user_id", this.userId)
      .order("confidence", { ascending: false });

    if (error) {
      console.error("Error fetching facts:", error);
      return [];
    }

    return (data || []).map((fact) => ({
      key: fact.key,
      value: fact.value,
      confidence: fact.confidence,
    }));
  }

  /**
   * Store a new message in the database
   *
   * @param content - Message content
   * @param role - Message role (user or assistant)
   * @param metadata - Optional metadata
   */
  async storeMessage(
    content: string,
    role: "user" | "assistant",
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const { data, error } = await this.client
      .from("messages")
      .insert({
        user_id: this.userId,
        content,
        role,
        metadata,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error storing message:", error);
      throw error;
    }

    // Generate and store embedding asynchronously (non-blocking)
    if (this.embeddingsService && data?.id) {
      this.generateAndStoreEmbedding(data.id, content).catch((err) => {
        console.warn("Failed to generate embedding for message:", err);
      });
    }
  }

  /**
   * Generate an embedding for content and store it on the message row.
   * Runs async/non-blocking so it doesn't slow down message responses.
   */
  private async generateAndStoreEmbedding(messageId: string, content: string): Promise<void> {
    if (!this.embeddingsService) return;

    const embedding = await this.embeddingsService.embed(content);

    const { error } = await this.client
      .from("messages")
      .update({ embedding })
      .eq("id", messageId);

    if (error) {
      console.warn("Failed to store embedding:", error);
    }
  }

  /**
   * Create a new goal
   *
   * @param description - Goal description
   * @param deadline - Optional deadline
   */
  async createGoal(description: string, deadline?: Date): Promise<void> {
    const { error } = await this.client.from("goals").insert({
      user_id: this.userId,
      description,
      deadline: deadline?.toISOString() || null,
      status: "active",
    });

    if (error) {
      console.error("Error creating goal:", error);
      throw error;
    }
  }

  /**
   * Update a goal status
   *
   * @param goalId - Goal ID
   * @param status - New status
   */
  async updateGoalStatus(
    goalId: string,
    status: "active" | "completed" | "cancelled"
  ): Promise<void> {
    const { error } = await this.client
      .from("goals")
      .update({ status })
      .eq("id", goalId)
      .eq("user_id", this.userId);

    if (error) {
      console.error("Error updating goal:", error);
      throw error;
    }
  }

  /**
   * Store or update a user fact
   *
   * @param key - Fact key
   * @param value - Fact value
   * @param confidence - Confidence score (0-1)
   */
  async upsertFact(key: string, value: string, confidence: number = 0.8): Promise<void> {
    // First check if fact exists
    const { data: existing } = await this.client
      .from("facts")
      .select("id")
      .eq("user_id", this.userId)
      .eq("key", key)
      .single();

    if (existing) {
      // Update existing
      const { error } = await this.client
        .from("facts")
        .update({ value, confidence, updated_at: new Date().toISOString() })
        .eq("id", existing.id);

      if (error) {
        console.error("Error updating fact:", error);
        throw error;
      }
    } else {
      // Insert new
      const { error } = await this.client.from("facts").insert({
        user_id: this.userId,
        key,
        value,
        confidence,
      });

      if (error) {
        console.error("Error inserting fact:", error);
        throw error;
      }
    }
  }

  /**
   * Semantic search for relevant messages
   *
   * @param query - Search query
   * @param limit - Maximum results
   * @returns Array of relevant messages
   */
  async semanticSearch(query: string, limit: number = 5): Promise<StoredMessage[]> {
    // If embeddings service is available, use pgvector similarity search
    if (this.embeddingsService) {
      try {
        const queryEmbedding = await this.embeddingsService.embed(query);

        const { data, error } = await this.client.rpc("search_similar_messages", {
          query_embedding: JSON.stringify(queryEmbedding),
          target_user_id: this.userId,
          limit_count: limit,
          similarity_threshold: 0.7,
        });

        if (error) {
          console.error("Semantic search RPC failed, falling back to text search:", error);
        } else if (data && data.length > 0) {
          // Map RPC results to StoredMessage format
          return (data as Array<{
            id: string;
            telegram_user_id: number;
            role: string;
            content: string;
            similarity: number;
            created_at?: string;
            metadata?: Record<string, unknown>;
          }>).map((row) => ({
            id: row.id,
            user_id: row.telegram_user_id,
            content: row.content,
            role: row.role as "user" | "assistant",
            created_at: row.created_at || new Date().toISOString(),
            metadata: row.metadata,
          }));
        }
      } catch (err) {
        console.error("Embedding generation failed, falling back to text search:", err);
      }
    }

    // Fallback: basic text search when embeddings are unavailable
    const { data, error } = await this.client
      .from("messages")
      .select("*")
      .eq("user_id", this.userId)
      .textSearch("content", query)
      .limit(limit);

    if (error) {
      console.error("Error searching messages:", error);
      return [];
    }

    return data || [];
  }

  /**
   * Get the Supabase client (for advanced usage)
   */
  getClient(): SupabaseClient {
    return this.client;
  }

  /**
   * Get the user ID
   */
  getUserId(): number {
    return this.userId;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a MemoryService instance from environment variables
 */
export function createMemoryService(userId: number): MemoryService {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL is required");
  }
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }

  return new MemoryService({ url, serviceKey }, userId);
}

/**
 * Create multiple MemoryService instances for multiple users
 */
export function createMemoryServices(userIds: number[]): Map<number, MemoryService> {
  const services = new Map<number, MemoryService>();

  for (const userId of userIds) {
    services.set(userId, createMemoryService(userId));
  }

  return services;
}
