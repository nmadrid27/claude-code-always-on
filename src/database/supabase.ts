/**
 * Supabase Client Configuration
 *
 * This module provides a configured Supabase client for database operations.
 * It reads connection details from environment variables:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_ANON_KEY: Anonymous key for client-side operations
 * - SUPABASE_SERVICE_ROLE_KEY: Service role key for admin operations (use carefully!)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type { SupabaseClient };

/**
 * Environment variables required for Supabase connection
 */
interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

/**
 * Validates that required environment variables are set
 */
function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL environment variable is not set");
  }

  if (!anonKey) {
    throw new Error("SUPABASE_ANON_KEY environment variable is not set");
  }

  return { url, anonKey, serviceRoleKey };
}

/**
 * Creates a Supabase client with the appropriate configuration
 *
 * @param config - Supabase connection configuration
 * @param useServiceRole - If true, uses service role key (bypasses RLS)
 * @returns Configured Supabase client
 */
export function createSupabaseClient(
  config?: SupabaseConfig,
  useServiceRole = false,
): SupabaseClient {
  const resolvedConfig = config ?? getSupabaseConfig();

  if (useServiceRole && !resolvedConfig.serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for admin operations but is not set"
    );
  }

  const key = useServiceRole ? resolvedConfig.serviceRoleKey! : resolvedConfig.anonKey;

  return createClient(resolvedConfig.url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: "public",
    },
  });
}

/**
 * Singleton instance for anonymous operations (respects RLS)
 */
let anonClient: SupabaseClient | null = null;

/**
 * Gets the anonymous Supabase client (respects Row Level Security)
 * This client operates with the user's context set via setUserId()
 */
export function getSupabaseClient(): SupabaseClient {
  if (!anonClient) {
    anonClient = createSupabaseClient();
  }
  return anonClient;
}

/**
 * Singleton instance for admin operations (bypasses RLS)
 * Use with caution! This client has full access to all data.
 */
let adminClient: SupabaseClient | null = null;

/**
 * Gets the admin Supabase client (bypasses Row Level Security)
 * Only use this for operations that need to access data across users.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (!adminClient) {
    adminClient = createSupabaseClient(undefined, true);
  }
  return adminClient;
}

/**
 * Sets the current user context for Row Level Security
 * This must be called before database operations when acting on behalf of a user
 *
 * @param userId - Telegram user ID to set as the current user
 * @returns A function to restore the previous user context
 */
export async function setUserId(
  client: SupabaseClient,
  userId: number,
): Promise<() => Promise<void>> {
  // Store previous context
  let previousId: unknown = null;
  try {
    const { data } = await client.rpc("get_current_user_id");
    previousId = data;
  } catch {
    previousId = null;
  }

  // Set new context
  await client.rpc("set_current_user_id", { user_id: userId });

  // Return restore function
  return async () => {
    if (previousId !== null) {
      await client.rpc("set_current_user_id", { user_id: previousId });
    }
  };
}

/**
 * Database row types matching our schema
 */
export interface MessageRow {
  id: string;
  telegram_user_id: number;
  telegram_message_id?: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  updated_at: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface GoalRow {
  id: string;
  telegram_user_id: number;
  title: string;
  description?: string;
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
  completed_at?: string;
  priority: number;
  category?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface UserFactRow {
  id: string;
  telegram_user_id: number;
  fact_type: string;
  fact_text: string;
  confidence: number;
  source?: string;
  source_message_id?: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
  access_count: number;
  embedding?: number[];
}

export interface ConversationContextRow {
  id: string;
  telegram_user_id: number;
  session_id: string;
  started_at: string;
  ended_at?: string;
  summary?: string;
  summary_embedding?: number[];
  message_count: number;
  metadata?: Record<string, unknown>;
}

/**
 * Vector similarity search result types
 */
export interface SimilarMessage {
  id: string;
  telegram_user_id: number;
  role: string;
  content: string;
  similarity: number;
}

export interface RelevantGoal {
  id: string;
  title: string;
  description?: string;
  status: string;
  similarity: number;
}

export interface RelevantFact {
  id: string;
  fact_type: string;
  fact_text: string;
  confidence: number;
  similarity: number;
}
