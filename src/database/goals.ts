/**
 * Goals Repository
 *
 * Manages user goals with semantic search capabilities.
 * Goals can be prioritized, categorized, and searched by relevance.
 */

import type {
  SupabaseClient,
  GoalRow,
  RelevantGoal,
} from "./supabase.js";

/**
 * Creates a new goal for a user
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param title - Goal title
 * @param description - Optional detailed description
 * @param priority - Priority 1-10 (default: 5)
 * @param category - Optional category label
 * @param embedding - Optional pre-computed embedding
 * @returns Created goal row or null
 */
export async function createGoal(
  client: SupabaseClient,
  userId: number,
  title: string,
  description?: string,
  priority = 5,
  category?: string,
  embedding?: number[],
): Promise<GoalRow | null> {
  const { data, error } = await client
    .from("goals")
    .insert({
      telegram_user_id: userId,
      title,
      description,
      priority,
      category,
      embedding: embedding ?? null,
    })
    .select()
    .maybeSingle();

  if (error) {
    console.error("[db:goals] Failed to create goal:", error);
    return null;
  }

  return data;
}

/**
 * Retrieves all goals for a user, optionally filtered by status
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param status - Optional status filter
 * @returns Array of goal rows
 */
export async function getGoals(
  client: SupabaseClient,
  userId: number,
  status?: "active" | "completed" | "archived",
): Promise<GoalRow[]> {
  let query = client
    .from("goals")
    .select("*")
    .eq("telegram_user_id", userId);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query.order("priority", { ascending: false });

  if (error) {
    console.error("[db:goals] Failed to retrieve goals:", error);
    return [];
  }

  return data ?? [];
}

/**
 * Gets active goals for a user
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @returns Array of active goals
 */
export async function getActiveGoals(
  client: SupabaseClient,
  userId: number,
): Promise<GoalRow[]> {
  return getGoals(client, userId, "active");
}

/**
 * Updates a goal's status
 *
 * @param client - Supabase client
 * @param goalId - Goal ID to update
 * @param status - New status
 * @returns True if successful
 */
export async function updateGoalStatus(
  client: SupabaseClient,
  goalId: string,
  status: "active" | "completed" | "archived",
): Promise<boolean> {
  const updates: Partial<GoalRow> = { status };

  if (status === "completed") {
    (updates as unknown as { completed_at: string }).completed_at =
      new Date().toISOString();
  }

  const { error } = await client
    .from("goals")
    .update(updates)
    .eq("id", goalId);

  if (error) {
    console.error("[db:goals] Failed to update status:", error);
    return false;
  }

  return true;
}

/**
 * Marks a goal as completed
 *
 * @param client - Supabase client
 * @param goalId - Goal ID to complete
 * @returns True if successful
 */
export async function completeGoal(
  client: SupabaseClient,
  goalId: string,
): Promise<boolean> {
  return updateGoalStatus(client, goalId, "completed");
}

/**
 * Archives a goal
 *
 * @param client - Supabase client
 * @param goalId - Goal ID to archive
 * @returns True if successful
 */
export async function archiveGoal(
  client: SupabaseClient,
  goalId: string,
): Promise<boolean> {
  return updateGoalStatus(client, goalId, "archived");
}

/**
 * Updates a goal's embedding
 *
 * @param client - Supabase client
 * @param goalId - Goal ID to update
 * @param embedding - New embedding vector
 * @returns True if successful
 */
export async function updateGoalEmbedding(
  client: SupabaseClient,
  goalId: string,
  embedding: number[],
): Promise<boolean> {
  const { error } = await client
    .from("goals")
    .update({ embedding })
    .eq("id", goalId);

  if (error) {
    console.error("[db:goals] Failed to update embedding:", error);
    return false;
  }

  return true;
}

/**
 * Performs semantic search to find goals relevant to a query
 *
 * @param client - Supabase client
 * @param queryEmbedding - Query embedding vector
 * @param userId - Telegram user ID
 * @param limit - Maximum results
 * @param threshold - Minimum similarity threshold
 * @returns Relevant goals with similarity scores
 */
export async function searchRelevantGoals(
  client: SupabaseClient,
  queryEmbedding: number[],
  userId: number,
  limit = 5,
  threshold = 0.6,
): Promise<RelevantGoal[]> {
  const { data, error } = await client.rpc("search_relevant_goals", {
    query_embedding: JSON.stringify(queryEmbedding),
    target_user_id: userId,
    limit_count: limit,
    similarity_threshold: threshold,
  });

  if (error) {
    console.error("[db:goals] Semantic search failed:", error);
    return [];
  }

  return data ?? [];
}

/**
 * Deletes a goal
 *
 * @param client - Supabase client
 * @param goalId - Goal ID to delete
 * @returns True if successful
 */
export async function deleteGoal(
  client: SupabaseClient,
  goalId: string,
): Promise<boolean> {
  const { error } = await client
    .from("goals")
    .delete()
    .eq("id", goalId);

  if (error) {
    console.error("[db:goals] Failed to delete goal:", error);
    return false;
  }

  return true;
}

/**
 * Gets goals by category
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @param category - Category to filter by
 * @returns Array of goals in the category
 */
export async function getGoalsByCategory(
  client: SupabaseClient,
  userId: number,
  category: string,
): Promise<GoalRow[]> {
  const { data, error } = await client
    .from("goals")
    .select("*")
    .eq("telegram_user_id", userId)
    .eq("category", category)
    .order("priority", { ascending: false });

  if (error) {
    console.error("[db:goals] Failed to get goals by category:", error);
    return [];
  }

  return data ?? [];
}

/**
 * Gets all categories for a user's goals
 *
 * @param client - Supabase client
 * @param userId - Telegram user ID
 * @returns Array of unique category names
 */
export async function getGoalCategories(
  client: SupabaseClient,
  userId: number,
): Promise<string[]> {
  const { data, error } = await client
    .from("goals")
    .select("category")
    .eq("telegram_user_id", userId)
    .not("category", "is", null);

  if (error) {
    console.error("[db:goals] Failed to get categories:", error);
    return [];
  }

  const categories = new Set(
    (data ?? []).map((g: { category: string | null }) => g.category).filter((c): c is string => c !== null),
  );

  return [...categories];
}
