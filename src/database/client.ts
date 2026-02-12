/**
 * Database Client
 *
 * High-level client that combines Supabase operations with embeddings.
 * This is the main interface for working with semantic memory.
 */

import type { SupabaseClient } from "./supabase.js";
import {
  createSupabaseClient,
  getSupabaseClient,
  getSupabaseAdminClient,
  type MessageRow,
  type GoalRow,
  type UserFactRow,
  type SimilarMessage,
  type RelevantGoal,
  type RelevantFact,
} from "./supabase.js";
import {
  storeMessage,
  storeMessages,
  getRecentMessages,
  getConversationContext,
  searchSimilarMessages,
  getMessageStats,
  type MessagePaginationResult,
} from "./messages.js";
import {
  createGoal,
  getActiveGoals,
  searchRelevantGoals,
  completeGoal,
  archiveGoal,
  deleteGoal,
} from "./goals.js";
import {
  upsertUserFact,
  getUserFacts,
  searchRelevantFacts,
  deleteFact,
  getFactsSummary,
  type FactType,
} from "./user-facts.js";
import {
  generateEmbedding,
  generateEmbeddings,
  type EmbeddingConfig,
} from "../services/embeddings.js";

/**
 * Memory system configuration
 */
export interface MemoryConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceKey?: string;
  openaiApiKey?: string;
  embeddingModel?: "text-embedding-3-small" | "text-embedding-3-large";
}

/**
 * Search result combining all memory types
 */
export interface MemorySearchResult {
  messages: Array<{
    content: string;
    similarity: number;
    role: string;
    createdAt: Date;
  }>;
  goals: Array<{
    title: string;
    description?: string;
    similarity: number;
    status: string;
  }>;
  facts: Array<{
    fact_text: string;
    fact_type: string;
    similarity: number;
    confidence: number;
  }>;
}

/**
 * Context retrieved for a user query
 */
export interface QueryContext {
  conversation: string; // Recent conversation history
  relevantMessages: SimilarMessage[];
  relevantGoals: RelevantGoal[];
  relevantFacts: RelevantFact[];
  userFacts: string; // Formatted facts summary
}

/**
 * Main database client for semantic memory operations
 */
export class DatabaseClient {
  private supabase: SupabaseClient;
  private adminSupabase: SupabaseClient;
  private embeddingConfig: EmbeddingConfig;

  constructor(config: MemoryConfig = {}) {
    // Initialize Supabase clients
    if (config.supabaseUrl && config.supabaseAnonKey) {
      this.supabase = createSupabaseClient({
        url: config.supabaseUrl,
        anonKey: config.supabaseAnonKey,
        serviceRoleKey: config.supabaseServiceKey,
      });
    } else {
      this.supabase = getSupabaseClient();
    }

    if (config.supabaseUrl && config.supabaseServiceKey) {
      this.adminSupabase = createSupabaseClient(
        {
          url: config.supabaseUrl,
          anonKey: config.supabaseServiceKey,
          serviceRoleKey: config.supabaseServiceKey,
        },
        true,
      );
    } else {
      this.adminSupabase = getSupabaseAdminClient();
    }

    // Configure embeddings
    this.embeddingConfig = {
      apiKey: config.openaiApiKey ?? process.env.OPENAI_API_KEY!,
      model: config.embeddingModel ?? "text-embedding-3-large",
    };
  }

  /**
   * Stores a user message with its embedding
   */
  async storeUserMessage(
    userId: number,
    content: string,
    telegramMessageId?: number,
  ): Promise<MessageRow | null> {
    const embedding = await generateEmbedding(content, this.embeddingConfig);
    return storeMessage(
      this.supabase,
      userId,
      "user",
      content,
      embedding,
      undefined,
      telegramMessageId,
    );
  }

  /**
   * Stores an assistant message with its embedding
   */
  async storeAssistantMessage(
    userId: number,
    content: string,
  ): Promise<MessageRow | null> {
    const embedding = await generateEmbedding(content, this.embeddingConfig);
    return storeMessage(
      this.supabase,
      userId,
      "assistant",
      content,
      embedding,
    );
  }

  /**
   * Gets recent conversation history for a user
   */
  async getConversationHistory(
    userId: number,
    limit = 50,
  ): Promise<MessageRow[]> {
    const result = await getRecentMessages(this.supabase, userId, limit);
    return result.messages;
  }

  /**
   * Gets formatted conversation context for LLM prompting
   */
  async getFormattedContext(userId: number, maxMessages = 20): Promise<string> {
    return getConversationContext(this.supabase, userId, maxMessages);
  }

  /**
   * Retrieves comprehensive context for a user's query
   * This includes recent conversation, semantically similar messages,
   * relevant goals, and relevant user facts.
   */
  async getQueryContext(
    userId: number,
    query: string,
    options?: {
      maxMessages?: number;
      maxSimilarMessages?: number;
      maxGoals?: number;
      maxFacts?: number;
      similarityThreshold?: number;
    },
  ): Promise<QueryContext> {
    const {
      maxMessages = 20,
      maxSimilarMessages = 5,
      maxGoals = 3,
      maxFacts = 10,
      similarityThreshold = 0.7,
    } = options ?? {};

    // Get recent conversation
    const conversation = await getConversationContext(
      this.supabase,
      userId,
      maxMessages,
    );

    // Generate query embedding
    const queryEmbedding = await generateEmbedding(
      query,
      this.embeddingConfig,
    );

    // Search for similar content in parallel
    const [relevantMessages, relevantGoals, relevantFacts, userFactsData] =
      await Promise.all([
        searchSimilarMessages(
          this.supabase,
          queryEmbedding,
          userId,
          maxSimilarMessages,
          similarityThreshold,
        ),
        searchRelevantGoals(
          this.supabase,
          queryEmbedding,
          userId,
          maxGoals,
          similarityThreshold - 0.1,
        ),
        searchRelevantFacts(
          this.supabase,
          queryEmbedding,
          userId,
          maxFacts,
          similarityThreshold - 0.05,
        ),
        getUserFacts(this.supabase, userId, undefined, 5),
      ]);

    // Format user facts
    const factsByType = new Map<string, UserFactRow[]>();
    for (const fact of userFactsData) {
      if (!factsByType.has(fact.fact_type)) {
        factsByType.set(fact.fact_type, []);
      }
      factsByType.get(fact.fact_type)!.push(fact);
    }

    const userFacts = Array.from(factsByType.entries())
      .map(
        ([type, facts]) =>
          `**${type}:** ${facts.map((f) => f.fact_text).join(", ")}`,
      )
      .join("\n");

    return {
      conversation,
      relevantMessages,
      relevantGoals,
      relevantFacts,
      userFacts,
    };
  }

  /**
   * Creates a new goal with semantic embedding
   */
  async createGoal(
    userId: number,
    title: string,
    description?: string,
    priority = 5,
    category?: string,
  ): Promise<GoalRow | null> {
    // Generate embedding from title + description
    const text = description ? `${title}: ${description}` : title;
    const embedding = await generateEmbedding(text, this.embeddingConfig);

    return createGoal(
      this.supabase,
      userId,
      title,
      description,
      priority,
      category,
      embedding,
    );
  }

  /**
   * Gets all active goals for a user
   */
  async getActiveGoals(userId: number): Promise<GoalRow[]> {
    return getActiveGoals(this.supabase, userId);
  }

  /**
   * Marks a goal as completed
   */
  async completeGoal(goalId: string): Promise<boolean> {
    return completeGoal(this.supabase, goalId);
  }

  /**
   * Archives a goal
   */
  async archiveGoal(goalId: string): Promise<boolean> {
    return archiveGoal(this.supabase, goalId);
  }

  /**
   * Deletes a goal
   */
  async deleteGoal(goalId: string): Promise<boolean> {
    return deleteGoal(this.supabase, goalId);
  }

  /**
   * Stores or updates a user fact with embedding
   */
  async upsertFact(
    userId: number,
    factType: FactType,
    factText: string,
    confidence = 5,
    source?: string,
  ): Promise<UserFactRow | null> {
    const embedding = await generateEmbedding(factText, this.embeddingConfig);
    return upsertUserFact(
      this.supabase,
      userId,
      factType,
      factText,
      confidence,
      source,
      embedding,
    );
  }

  /**
   * Gets all facts for a user
   */
  async getUserFacts(
    userId: number,
    factType?: FactType,
    minConfidence = 1,
  ): Promise<UserFactRow[]> {
    return getUserFacts(this.supabase, userId, factType, minConfidence);
  }

  /**
   * Gets formatted facts summary for LLM prompting
   */
  async getFactsSummary(userId: number, minConfidence = 5): Promise<string> {
    return getFactsSummary(this.supabase, userId, minConfidence);
  }

  /**
   * Deletes a fact
   */
  async deleteFact(factId: string): Promise<boolean> {
    return deleteFact(this.supabase, factId);
  }

  /**
   * Gets message statistics for a user
   */
  async getStats(userId: number) {
    return getMessageStats(this.supabase, userId);
  }

  /**
   * Performs semantic search across all memory types
   */
  async semanticSearch(
    userId: number,
    query: string,
    options?: {
      maxMessages?: number;
      maxGoals?: number;
      maxFacts?: number;
      threshold?: number;
    },
  ): Promise<MemorySearchResult> {
    const {
      maxMessages = 10,
      maxGoals = 5,
      maxFacts = 10,
      threshold = 0.7,
    } = options ?? {};

    const queryEmbedding = await generateEmbedding(
      query,
      this.embeddingConfig,
    );

    const [messages, goals, facts] = await Promise.all([
      searchSimilarMessages(this.supabase, queryEmbedding, userId, maxMessages, threshold),
      searchRelevantGoals(this.supabase, queryEmbedding, userId, maxGoals, threshold - 0.1),
      searchRelevantFacts(this.supabase, queryEmbedding, userId, maxFacts, threshold - 0.05),
    ]);

    return {
      messages: messages.map((m) => ({
        content: m.content,
        similarity: m.similarity,
        role: m.role,
        createdAt: new Date((m as unknown as { created_at: string }).created_at),
      })),
      goals: goals.map((g) => ({
        title: g.title,
        description: g.description,
        similarity: g.similarity,
        status: g.status,
      })),
      facts: facts.map((f) => ({
        fact_text: f.fact_text,
        fact_type: f.fact_type,
        similarity: f.similarity,
        confidence: f.confidence,
      })),
    };
  }

  /**
   * Batch store messages with embeddings
   * More efficient for storing conversation history
   */
  async storeMessagesBatch(
    userId: number,
    messages: Array<{
      role: "user" | "assistant" | "system";
      content: string;
      telegramMessageId?: number;
    }>,
  ): Promise<MessageRow[]> {
    // Generate embeddings in batch
    const texts = messages.map((m) => m.content);
    const embeddings = await generateEmbeddings(texts, this.embeddingConfig);

    // Combine messages with embeddings
    const messagesWithEmbeddings = messages.map((m, i) => ({
      userId,
      role: m.role,
      content: m.content,
      embedding: embeddings[i],
      telegramMessageId: m.telegramMessageId,
    }));

    // Store in database
    return storeMessages(this.supabase, messagesWithEmbeddings);
  }
}

/**
 * Creates a database client from environment variables
 */
export function createDatabaseClient(
  config?: MemoryConfig,
): DatabaseClient {
  return new DatabaseClient(config);
}

/**
 * Singleton database client instance
 */
let dbClient: DatabaseClient | null = null;

/**
 * Gets the singleton database client
 */
export function getDatabaseClient(): DatabaseClient {
  if (!dbClient) {
    dbClient = new DatabaseClient();
  }
  return dbClient;
}
