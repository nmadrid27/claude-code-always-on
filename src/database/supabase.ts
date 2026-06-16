/**
 * Database handle + row types
 *
 * Historically this module wrapped a Supabase/Postgres client. The backend is
 * now local SQLite (see ./sqlite.ts). The filename and the `getSupabaseClient`
 * export names are retained for backward compatibility with the many call sites
 * that import them; they now return the SQLite database handle.
 *
 * `SupabaseClient` is kept as a type alias for `BotDatabase` so existing
 * signatures continue to type-check.
 */

import { getDb, type BotDatabase } from "./sqlite.js";

/** Backward-compatible alias for the database handle type. */
export type SupabaseClient = BotDatabase;

/**
 * Returns the bot's database handle. (Formerly the anon Supabase client.)
 */
export function getSupabaseClient(): BotDatabase {
  return getDb();
}

/**
 * Returns the bot's database handle. (Formerly the service-role Supabase
 * client; SQLite has no row-level security, so this is the same handle.)
 */
export function getSupabaseAdminClient(): BotDatabase {
  return getDb();
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
