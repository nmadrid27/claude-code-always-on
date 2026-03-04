-- ============================================================================
-- Security Hardening: Fix Supabase linter errors/warnings
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. VIEWS: Recreate with SECURITY INVOKER (fixes security_definer_view ERROR)
--    Without this, views run as the view owner (superuser), bypassing RLS.
--    With security_invoker = true, views run as the querying user (Postgres 15+).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW recent_messages WITH (security_invoker = true) AS
  SELECT m.id, m.telegram_user_id, m.role, m.content, m.created_at, m.metadata
  FROM messages m
  ORDER BY m.created_at DESC;

CREATE OR REPLACE VIEW active_goals WITH (security_invoker = true) AS
  SELECT g.id, g.telegram_user_id, g.title, g.description, g.priority, g.category, g.created_at
  FROM goals g
  WHERE g.status = 'active'
  ORDER BY g.priority DESC, g.created_at ASC;

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS: Pin search_path to prevent schema injection
--    (fixes function_search_path_mutable WARN)
--    An attacker with schema creation rights could shadow public.messages etc.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION search_similar_messages(
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION search_relevant_goals(
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION search_relevant_facts(
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ----------------------------------------------------------------------------
-- 3. RLS POLICIES: Drop always-true policies (fixes rls_policy_always_true WARN)
--    service_role bypasses RLS in Supabase by default — no explicit policy
--    is required. The USING (true) policies were granting any authenticated or
--    anon user unrestricted cross-user access, which is overly permissive.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access messages" ON messages;
DROP POLICY IF EXISTS "Service role full access goals" ON goals;
DROP POLICY IF EXISTS "Service role full access facts" ON user_facts;
DROP POLICY IF EXISTS "Service role full access contexts" ON conversation_contexts;

-- Note: extension_in_public (vector in public schema) is intentionally not
-- addressed here. Moving it requires dropping and recreating all vector(3072)
-- columns — high risk with no functional benefit for a single-service backend.
