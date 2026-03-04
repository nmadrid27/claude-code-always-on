-- ============================================================================
-- Switch embedding dimensions from 3072 (OpenAI) to 1024 (Voyage AI voyage-3)
-- All existing embedding columns are NULL so no data migration is needed.
-- ============================================================================

ALTER TABLE messages ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE goals ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE user_facts ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE conversation_contexts ALTER COLUMN summary_embedding TYPE vector(1024);

CREATE OR REPLACE FUNCTION search_similar_messages(
  query_embedding vector(1024),
  target_user_id BIGINT DEFAULT NULL,
  limit_count INTEGER DEFAULT 10,
  similarity_threshold REAL DEFAULT 0.7
)
RETURNS TABLE (
  id UUID, telegram_user_id BIGINT, role TEXT, content TEXT, similarity REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.telegram_user_id, m.role, m.content,
    (1 - (m.embedding <=> query_embedding))::REAL AS similarity
  FROM messages m
  WHERE m.embedding IS NOT NULL
    AND (target_user_id IS NULL OR m.telegram_user_id = target_user_id)
    AND (1 - (m.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION search_relevant_goals(
  query_embedding vector(1024),
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
    (1 - (g.embedding <=> query_embedding))::REAL AS similarity
  FROM goals g
  WHERE g.telegram_user_id = target_user_id
    AND g.embedding IS NOT NULL AND g.status = 'active'
    AND (1 - (g.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY g.embedding <=> query_embedding
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION search_relevant_facts(
  query_embedding vector(1024),
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
    (1 - (f.embedding <=> query_embedding))::REAL AS similarity
  FROM user_facts f
  WHERE f.telegram_user_id = target_user_id
    AND f.embedding IS NOT NULL
    AND (1 - (f.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY f.embedding <=> query_embedding
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
