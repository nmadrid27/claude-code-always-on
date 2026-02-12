/**
 * User Facts Repository
 *
 * Stores and retrieves facts about users for personalization.
 * Facts can be preferences, context, relationships, or habits.
 */

import type {
  SupabaseClient,
  UserFactRow,
  RelevantFact,
} from "./supabase.js";

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

/**
 * Creates or updates a user fact
 * Uses upsert to handle the unique constraint on (user_id, type, text)
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param factType - Type of fact
 * @param factText - The fact text
 * @param confidence - Confidence score 1-10
 * @param source - Where this fact came from
 * @param embedding - Optional pre-computed embedding
 * @returns Created or updated fact row
 */
export async function upsertUserFact(
  client: SupabaseClient,
  userId: number,
  factType: FactType,
  factText: string,
  confidence = 5,
  source?: string,
  embedding?: number[],
): Promise<UserFactRow | null> {
  const { data, error } = await client
    .from("user_facts")
    .upsert(
      {
        telegram_user_id: userId,
        fact_type: factType,
        fact_text: factText,
        confidence: Math.max(1, Math.min(10, confidence)),
        source,
        embedding: embedding ?? null,
        last_accessed_at: new Date().toISOString(),
      },
      {
        onConflict: "telegram_user_id,fact_type,fact_text",
        ignoreDuplicates: false,
      },
    )
    .select()
    .maybeSingle();

  if (error) {
    console.error("[db:facts] Failed to upsert fact:", error);
    return null;
  }

  return data;
}

/**
 * Retrieves all facts for a user, optionally filtered by type
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param factType - Optional type filter
 * @param minConfidence - Minimum confidence threshold
 * @returns Array of fact rows
 */
export async function getUserFacts(
  client: SupabaseClient,
  userId: number,
  factType?: FactType,
  minConfidence = 1,
): Promise<UserFactRow[]> {
  let query = client
    .from("user_facts")
    .select("*")
    .eq("telegram_user_id", userId)
    .gte("confidence", minConfidence);

  if (factType) {
    query = query.eq("fact_type", factType);
  }

  const { data, error } = await query.order("confidence", { ascending: false });

  if (error) {
    console.error("[db:facts] Failed to retrieve facts:", error);
    return [];
  }

  // Update access count
  for (const fact of data ?? []) {
    await client
      .from("user_facts")
      .update({
        last_accessed_at: new Date().toISOString(),
        access_count: (fact.access_count ?? 0) + 1,
      })
      .eq("id", fact.id);
  }

  return data ?? [];
}

/**
 * Gets facts of a specific type for a user
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param factType - Type of facts to retrieve
 * @returns Array of facts of the specified type
 */
export async function getFactsByType(
  client: SupabaseClient,
  userId: number,
  factType: FactType,
): Promise<UserFactRow[]> {
  return getUserFacts(client, userId, factType);
}

/**
 * Performs semantic search to find facts relevant to a query
 *
 * @param client - Supabase client
 * @param queryEmbedding - Query embedding vector
 * @param userId - Telegram user ID
 * @param limit - Maximum results
 * @param threshold - Minimum similarity threshold
 * @returns Relevant facts with similarity scores
 */
export async function searchRelevantFacts(
  client: SupabaseClient,
  queryEmbedding: number[],
  userId: number,
  limit = 10,
  threshold = 0.65,
): Promise<RelevantFact[]> {
  const { data, error } = await client.rpc("search_relevant_facts", {
    query_embedding: JSON.stringify(queryEmbedding),
    target_user_id: userId,
    limit_count: limit,
    similarity_threshold: threshold,
  });

  if (error) {
    console.error("[db:facts] Semantic search failed:", error);
    return [];
  }

  return data ?? [];
}

/**
 * Updates a fact's confidence score
 *
 * @param client - Supabase client
 * @param factId - Fact ID to update
 * @param confidence - New confidence score 1-10
 * @returns True if successful
 */
export async function updateFactConfidence(
  client: SupabaseClient,
  factId: string,
  confidence: number,
): Promise<boolean> {
  const { error } = await client
    .from("user_facts")
    .update({ confidence: Math.max(1, Math.min(10, confidence)) })
    .eq("id", factId);

  if (error) {
    console.error("[db:facts] Failed to update confidence:", error);
    return false;
  }

  return true;
}

/**
 * Updates a fact's embedding
 *
 * @param client - Supabase client
 * @param factId - Fact ID to update
 * @param embedding - New embedding vector
 * @returns True if successful
 */
export async function updateFactEmbedding(
  client: SupabaseClient,
  factId: string,
  embedding: number[],
): Promise<boolean> {
  const { error } = await client
    .from("user_facts")
    .update({ embedding })
    .eq("id", factId);

  if (error) {
    console.error("[db:facts] Failed to update embedding:", error);
    return false;
  }

  return true;
}

/**
 * Deletes a fact
 *
 * @param client - Supabase client
 * @param factId - Fact ID to delete
 * @returns True if successful
 */
export async function deleteFact(
  client: SupabaseClient,
  factId: string,
): Promise<boolean> {
  const { error } = await client
    .from("user_facts")
    .delete()
    .eq("id", factId);

  if (error) {
    console.error("[db:facts] Failed to delete fact:", error);
    return false;
  }

  return true;
}

/**
 * Deletes all facts of a specific type for a user
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param factType - Type of facts to delete
 * @returns Number of facts deleted
 */
export async function deleteFactsByType(
  client: SupabaseClient,
  userId: number,
  factType: FactType,
): Promise<number> {
  const { data, error } = await client
    .from("user_facts")
    .delete()
    .eq("telegram_user_id", userId)
    .eq("fact_type", factType)
    .select("*");

  if (error) {
    console.error("[db:facts] Failed to delete facts by type:", error);
    return 0;
  }

  return data?.length ?? 0;
}

/**
 * Gets a summary of all facts for a user
 * Useful for building context for LLM prompts
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param minConfidence - Minimum confidence threshold
 * @returns Formatted facts string
 */
export async function getFactsSummary(
  client: SupabaseClient,
  userId: number,
  minConfidence = 5,
): Promise<string> {
  const facts = await getUserFacts(client, userId, undefined, minConfidence);

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
    const factStrings = typeFacts.map((f) => `- ${f.fact_text} (confidence: ${f.confidence})`);
    sections.push(`**${type.charAt(0).toUpperCase() + type.slice(1)}s:**\n${factStrings.join("\n")}`);
  }

  return `## User Facts\n\n${sections.join("\n\n")}`;
}

/**
 * Infers and stores facts from a conversation
 * This is a convenience function for fact extraction
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param facts - Array of inferred facts
 * @returns Number of facts stored
 */
export async function storeInferredFacts(
  client: SupabaseClient,
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
      client,
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
