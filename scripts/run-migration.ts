// scripts/run-migration.ts
// Run database migrations against Supabase
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

// Split migration into individual statements
const statements = [
  // 1. Enable pgvector
  `CREATE EXTENSION IF NOT EXISTS vector;`,

  // 2. Messages table
  `CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id BIGINT NOT NULL,
    telegram_message_id BIGINT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    embedding vector(3072),
    metadata JSONB DEFAULT '{}'::jsonb
  );`,

  // 3. Messages indexes
  `CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages(telegram_user_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);`,

  // 4. Goals table
  `CREATE TABLE IF NOT EXISTS goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id BIGINT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    category TEXT,
    embedding vector(3072),
    metadata JSONB DEFAULT '{}'::jsonb
  );`,

  // 5. Goals indexes
  `CREATE INDEX IF NOT EXISTS idx_goals_user_status ON goals(telegram_user_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_goals_priority ON goals(priority DESC);`,

  // 6. User facts table
  `CREATE TABLE IF NOT EXISTS user_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id BIGINT NOT NULL,
    fact_type TEXT NOT NULL,
    fact_text TEXT NOT NULL,
    confidence INTEGER DEFAULT 5 CHECK (confidence BETWEEN 1 AND 10),
    source TEXT,
    source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
    access_count INTEGER DEFAULT 0,
    embedding vector(3072),
    UNIQUE (telegram_user_id, fact_type, fact_text)
  );`,

  // 7. User facts indexes
  `CREATE INDEX IF NOT EXISTS idx_facts_user_type ON user_facts(telegram_user_id, fact_type);`,
  `CREATE INDEX IF NOT EXISTS idx_facts_confidence ON user_facts(confidence DESC);`,

  // 8. Conversation contexts table
  `CREATE TABLE IF NOT EXISTS conversation_contexts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id BIGINT NOT NULL,
    session_id TEXT NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    summary TEXT,
    summary_embedding vector(3072),
    message_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    UNIQUE (telegram_user_id, session_id)
  );`,

  // 9. Context indexes
  `CREATE INDEX IF NOT EXISTS idx_contexts_user_time ON conversation_contexts(telegram_user_id, started_at DESC);`,

  // 10. Updated_at trigger function
  `CREATE OR REPLACE FUNCTION update_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;`,

  // 11. Triggers
  `DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
  CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();`,

  `DROP TRIGGER IF EXISTS update_goals_updated_at ON goals;
  CREATE TRIGGER update_goals_updated_at
  BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();`,

  `DROP TRIGGER IF EXISTS update_user_facts_updated_at ON user_facts;
  CREATE TRIGGER update_user_facts_updated_at
  BEFORE UPDATE ON user_facts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();`,

  // 12. Semantic search functions
  `CREATE OR REPLACE FUNCTION search_similar_messages(
    query_embedding vector(3072),
    target_user_id BIGINT DEFAULT NULL,
    limit_count INTEGER DEFAULT 10,
    similarity_threshold REAL DEFAULT 0.7
  )
  RETURNS TABLE (
    id UUID,
    telegram_user_id BIGINT,
    role TEXT,
    content TEXT,
    similarity REAL
  ) AS $$
  BEGIN
    RETURN QUERY
    SELECT m.id, m.telegram_user_id, m.role, m.content,
      1 - (m.embedding <=> query_embedding) AS similarity
    FROM messages m
    WHERE m.embedding IS NOT NULL
      AND (target_user_id IS NULL OR m.telegram_user_id = target_user_id)
      AND (1 - (m.embedding <=> query_embedding)) >= similarity_threshold
    ORDER BY m.embedding <=> query_embedding
    LIMIT limit_count;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;`,

  `CREATE OR REPLACE FUNCTION search_relevant_goals(
    query_embedding vector(3072),
    target_user_id BIGINT,
    limit_count INTEGER DEFAULT 5,
    similarity_threshold REAL DEFAULT 0.6
  )
  RETURNS TABLE (
    id UUID, title TEXT, description TEXT, status TEXT, similarity REAL
  ) AS $$
  BEGIN
    RETURN QUERY
    SELECT g.id, g.title, g.description, g.status,
      1 - (g.embedding <=> query_embedding) AS similarity
    FROM goals g
    WHERE g.telegram_user_id = target_user_id
      AND g.embedding IS NOT NULL AND g.status = 'active'
      AND (1 - (g.embedding <=> query_embedding)) >= similarity_threshold
    ORDER BY g.embedding <=> query_embedding
    LIMIT limit_count;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;`,

  `CREATE OR REPLACE FUNCTION search_relevant_facts(
    query_embedding vector(3072),
    target_user_id BIGINT,
    limit_count INTEGER DEFAULT 10,
    similarity_threshold REAL DEFAULT 0.65
  )
  RETURNS TABLE (
    id UUID, fact_type TEXT, fact_text TEXT, confidence INTEGER, similarity REAL
  ) AS $$
  BEGIN
    RETURN QUERY
    SELECT f.id, f.fact_type, f.fact_text, f.confidence,
      1 - (f.embedding <=> query_embedding) AS similarity
    FROM user_facts f
    WHERE f.telegram_user_id = target_user_id
      AND f.embedding IS NOT NULL
      AND (1 - (f.embedding <=> query_embedding)) >= similarity_threshold
    ORDER BY f.embedding <=> query_embedding
    LIMIT limit_count;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;`,

  // 13. Enable RLS
  `ALTER TABLE messages ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE goals ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE user_facts ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE conversation_contexts ENABLE ROW LEVEL SECURITY;`,

  // 14. Service role bypass policies (our bot uses service_role key)
  `CREATE POLICY IF NOT EXISTS "Service role full access messages" ON messages FOR ALL USING (true) WITH CHECK (true);`,
  `CREATE POLICY IF NOT EXISTS "Service role full access goals" ON goals FOR ALL USING (true) WITH CHECK (true);`,
  `CREATE POLICY IF NOT EXISTS "Service role full access facts" ON user_facts FOR ALL USING (true) WITH CHECK (true);`,
  `CREATE POLICY IF NOT EXISTS "Service role full access contexts" ON conversation_contexts FOR ALL USING (true) WITH CHECK (true);`,

  // 15. Views
  `CREATE OR REPLACE VIEW recent_messages AS
  SELECT m.id, m.telegram_user_id, m.role, m.content, m.created_at, m.metadata
  FROM messages m ORDER BY m.created_at DESC;`,

  `CREATE OR REPLACE VIEW active_goals AS
  SELECT g.id, g.telegram_user_id, g.title, g.description, g.priority, g.category, g.created_at
  FROM goals g WHERE g.status = 'active' ORDER BY g.priority DESC, g.created_at ASC;`,
];

console.log("Running database migration...\n");

let success = 0;
let failed = 0;

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const label = stmt.substring(0, 60).replace(/\n/g, " ").trim();

  try {
    const { error } = await supabase.rpc("exec_sql", { query: stmt });

    if (error) {
      // Try direct query via postgrest if rpc doesn't work
      throw error;
    }
    console.log(`  ✅ [${i + 1}/${statements.length}] ${label}...`);
    success++;
  } catch (err: any) {
    // For statements that can't run via RPC, log them for manual execution
    console.log(`  ⚠️  [${i + 1}/${statements.length}] ${label}... (needs manual SQL)`);
    failed++;
  }
}

console.log(`\nMigration complete: ${success} succeeded, ${failed} need manual execution`);

if (failed > 0) {
  console.log("\nFor statements that failed, copy the SQL from:");
  console.log("  supabase/migrations/001_initial_schema.sql");
  console.log("And paste it into the Supabase SQL Editor at:");
  console.log(`  ${url}/project/default/sql`);
}

// Test the connection by inserting and deleting a test message
console.log("\nTesting database connection...");
const { data, error } = await supabase
  .from("messages")
  .select("count")
  .limit(1);

if (error) {
  if (error.code === "42P01") {
    console.log("Tables not yet created. Please run the SQL migration manually.");
  } else {
    console.log(`Connection test: ${error.message}`);
  }
} else {
  console.log("✅ Database connection verified! Tables are accessible.");
}
