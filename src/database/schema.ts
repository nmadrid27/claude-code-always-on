/**
 * SQLite Schema
 *
 * Local SQLite schema for the bot's semantic memory. Translated from the
 * original Postgres migrations (supabase/migrations/001-003) with these
 * dialect changes:
 *   - pgvector `vector(N)` columns -> `embedding TEXT` holding a JSON array.
 *     Similarity search is done in JS (see services/embeddings.ts cosine).
 *   - `gen_random_uuid()` ids -> application-generated UUIDs (TEXT).
 *   - `TIMESTAMPTZ DEFAULT NOW()` -> `TEXT` ISO-8601 set by the repository
 *     layer (keeps the exact string format the rest of the code expects).
 *   - `JSONB` -> `TEXT` holding JSON.
 *   - RLS, triggers, views, and Postgres functions are dropped; they are not
 *     needed for a single-user, single-process local database.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id                  TEXT PRIMARY KEY,
  telegram_user_id    INTEGER NOT NULL,
  telegram_message_id INTEGER,
  role                TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content             TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  embedding           TEXT,
  metadata            TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages(telegram_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);

CREATE TABLE IF NOT EXISTS goals (
  id               TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  completed_at     TEXT,
  priority         INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  category         TEXT,
  embedding        TEXT,
  metadata         TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_goals_user_status ON goals(telegram_user_id, status);
CREATE INDEX IF NOT EXISTS idx_goals_priority ON goals(priority DESC);

CREATE TABLE IF NOT EXISTS user_facts (
  id                TEXT PRIMARY KEY,
  telegram_user_id  INTEGER NOT NULL,
  fact_type         TEXT NOT NULL,
  fact_text         TEXT NOT NULL,
  confidence        INTEGER NOT NULL DEFAULT 5 CHECK (confidence BETWEEN 1 AND 10),
  source            TEXT,
  source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_accessed_at  TEXT NOT NULL,
  access_count      INTEGER NOT NULL DEFAULT 0,
  embedding         TEXT,
  UNIQUE (telegram_user_id, fact_type, fact_text)
);
CREATE INDEX IF NOT EXISTS idx_facts_user_type ON user_facts(telegram_user_id, fact_type);
CREATE INDEX IF NOT EXISTS idx_facts_confidence ON user_facts(confidence DESC);

CREATE TABLE IF NOT EXISTS conversation_contexts (
  id                TEXT PRIMARY KEY,
  telegram_user_id  INTEGER NOT NULL,
  session_id        TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  summary           TEXT,
  summary_embedding TEXT,
  message_count     INTEGER NOT NULL DEFAULT 0,
  metadata          TEXT NOT NULL DEFAULT '{}',
  UNIQUE (telegram_user_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_contexts_user_time ON conversation_contexts(telegram_user_id, started_at DESC);
`;

import type { Database } from "bun:sqlite";

/**
 * Applies the schema to a database connection. Idempotent (uses IF NOT EXISTS).
 */
export function applySchema(db: Database): void {
  db.exec(SCHEMA_SQL);
}
