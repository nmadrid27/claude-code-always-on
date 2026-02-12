/**
 * Message Repository
 *
 * Handles all database operations for storing and retrieving messages
 * with semantic search capabilities using pgvector.
 */

import type {
  SupabaseClient,
  MessageRow,
  SimilarMessage,
} from "./supabase.js";

/**
 * Result type for paginated message queries
 */
export interface MessagePaginationResult {
  messages: MessageRow[];
  hasMore: boolean;
  totalCount?: number;
}

/**
 * Stores a new message in the database
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param role - Message role (user, assistant, system)
 * @param content - Message content
 * @param embedding - Optional pre-computed embedding vector
 * @param metadata - Optional metadata JSON
 * @param telegramMessageId - Optional Telegram message ID
 * @returns The created message row or null
 */
export async function storeMessage(
  client: SupabaseClient,
  userId: number,
  role: "user" | "assistant" | "system",
  content: string,
  embedding?: number[],
  metadata?: Record<string, unknown>,
  telegramMessageId?: number,
): Promise<MessageRow | null> {
  const { data, error } = await client
    .from("messages")
    .insert({
      telegram_user_id: userId,
      telegram_message_id: telegramMessageId,
      role,
      content,
      embedding: embedding ?? null,
      metadata: metadata ?? {},
    })
    .select()
    .maybeSingle();

  if (error) {
    console.error("[db:messages] Failed to store message:", error);
    return null;
  }

  return data;
}

/**
 * Stores multiple messages in a single batch operation
 *
 * @param client - Supabase client
 * @param messages - Array of message data to insert
 * @returns Array of created message rows
 */
export async function storeMessages(
  client: SupabaseClient,
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

  const rows = messages.map((m) => ({
    telegram_user_id: m.userId,
    telegram_message_id: m.telegramMessageId,
    role: m.role,
    content: m.content,
    embedding: m.embedding ?? null,
    metadata: m.metadata ?? {},
  }));

  const { data, error } = await client
    .from("messages")
    .insert(rows)
    .select();

  if (error) {
    console.error("[db:messages] Failed to store messages batch:", error);
    return [];
  }

  return data ?? [];
}

/**
 * Retrieves recent messages for a user
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param limit - Maximum number of messages to retrieve
 * @param offset - Number of messages to skip (for pagination)
 * @returns Paginated messages with metadata
 */
export async function getRecentMessages(
  client: SupabaseClient,
  userId: number,
  limit = 50,
  offset = 0,
): Promise<MessagePaginationResult> {
  const { data, error, count } = await client
    .from("messages")
    .select("*", { count: "exact" })
    .eq("telegram_user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[db:messages] Failed to retrieve messages:", error);
    return { messages: [], hasMore: false };
  }

  return {
    messages: data ?? [],
    hasMore: (data?.length ?? 0) === limit,
    totalCount: count ?? undefined,
  };
}

/**
 * Retrieves conversation history within a date range
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param startDate - Start of date range
 * @param endDate - End of date range
 * @returns Messages within the specified range
 */
export async function getMessagesInRange(
  client: SupabaseClient,
  userId: number,
  startDate: Date,
  endDate: Date,
): Promise<MessageRow[]> {
  const { data, error } = await client
    .from("messages")
    .select("*")
    .eq("telegram_user_id", userId)
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[db:messages] Failed to retrieve messages in range:", error);
    return [];
  }

  return data ?? [];
}

/**
 * Updates a message's embedding vector
 * Useful when embeddings are computed asynchronously
 *
 * @param client - Supabase client
 * @param messageId - Message ID to update
 * @param embedding - Embedding vector
 * @returns True if successful
 */
export async function updateMessageEmbedding(
  client: SupabaseClient,
  messageId: string,
  embedding: number[],
): Promise<boolean> {
  const { error } = await client
    .from("messages")
    .update({ embedding })
    .eq("id", messageId);

  if (error) {
    console.error("[db:messages] Failed to update embedding:", error);
    return false;
  }

  return true;
}

/**
 * Performs semantic search to find similar messages
 *
 * @param client - Supabase client
 * @param queryEmbedding - Query embedding vector
 * @param userId - Optional user ID to filter by
 * @param limit - Maximum results
 * @param threshold - Minimum similarity threshold (0-1)
 * @returns Similar messages with similarity scores
 */
export async function searchSimilarMessages(
  client: SupabaseClient,
  queryEmbedding: number[],
  userId?: number,
  limit = 10,
  threshold = 0.7,
): Promise<SimilarMessage[]> {
  const { data, error } = await client.rpc("search_similar_messages", {
    query_embedding: JSON.stringify(queryEmbedding),
    target_user_id: userId ?? null,
    limit_count: limit,
    similarity_threshold: threshold,
  });

  if (error) {
    console.error("[db:messages] Semantic search failed:", error);
    return [];
  }

  return data ?? [];
}

/**
 * Deletes a message by ID
 *
 * @param client - Supabase client
 * @param messageId - Message ID to delete
 * @returns True if successful
 */
export async function deleteMessage(
  client: SupabaseClient,
  messageId: string,
): Promise<boolean> {
  const { error } = await client
    .from("messages")
    .delete()
    .eq("id", messageId);

  if (error) {
    console.error("[db:messages] Failed to delete message:", error);
    return false;
  }

  return true;
}

/**
 * Deletes all messages for a user
 * Use with caution - this is irreversible
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @returns Number of messages deleted
 */
export async function deleteAllUserMessages(
  client: SupabaseClient,
  userId: number,
): Promise<number> {
  const { data, error } = await client
    .from("messages")
    .delete()
    .eq("telegram_user_id", userId)
    .select("*");

  if (error) {
    console.error("[db:messages] Failed to delete user messages:", error);
    return 0;
  }

  return data?.length ?? 0;
}

/**
 * Gets message statistics for a user
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @returns Statistics object
 */
export async function getMessageStats(
  client: SupabaseClient,
  userId: number,
): Promise<{
  total: number;
  user: number;
  assistant: number;
  system: number;
  withEmbeddings: number;
}> {
  // Get total counts by role
  const { data: roleData, error: roleError } = await client
    .from("messages")
    .select("role")
    .eq("telegram_user_id", userId);

  if (roleError) {
    console.error("[db:messages] Failed to get stats:", roleError);
    return { total: 0, user: 0, assistant: 0, system: 0, withEmbeddings: 0 };
  }

  const messages = roleData ?? [];
  const total = messages.length;
  const user = messages.filter((m: { role: string }) => m.role === "user").length;
  const assistant = messages.filter((m: { role: string }) => m.role === "assistant").length;
  const system = messages.filter((m: { role: string }) => m.role === "system").length;

  // Get count with embeddings
  const { count: withEmbeddings } = await client
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("telegram_user_id", userId)
    .not("embedding", "is", null);

  return {
    total,
    user,
    assistant,
    system,
    withEmbeddings: withEmbeddings ?? 0,
  };
}

/**
 * Retrieves recent conversation context for LLM prompting
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param maxMessages - Maximum messages to include
 * @returns Formatted conversation string
 */
export async function getConversationContext(
  client: SupabaseClient,
  userId: number,
  maxMessages = 20,
): Promise<string> {
  const { messages } = await getRecentMessages(client, userId, maxMessages);

  if (messages.length === 0) {
    return "";
  }

  // Reverse to get chronological order
  const chronological = [...messages].reverse();

  return chronological
    .map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`)
    .join("\n\n");
}
