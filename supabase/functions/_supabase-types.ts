/**
 * Supabase Edge Functions Types
 *
 * Shared types for Edge Functions that handle sensitive operations
 * without exposing API keys to the client.
 */

/**
 * Request/Response types for embeddings Edge Function
 */
export interface EmbeddingsRequest {
  texts: string[];
  model?: "text-embedding-3-small" | "text-embedding-3-large";
}

export interface EmbeddingsResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Request/Response types for semantic search Edge Function
 */
export interface SemanticSearchRequest {
  query: string;
  table: "messages" | "goals" | "user_facts";
  userId: number;
  limit?: number;
  threshold?: number;
}

export interface SemanticSearchResponse {
  results: Array<{
    id: string;
    content: string;
    similarity: number;
    metadata?: Record<string, unknown>;
  }>;
}

/**
 * Request/Response types for fact extraction Edge Function
 */
export interface ExtractFactsRequest {
  text: string;
  userId: number;
  context?: string;
}

export interface ExtractFactsResponse {
  facts: Array<{
    type: string;
    text: string;
    confidence: number;
  }>;
}

/**
 * Error response type
 */
export interface ErrorResponse {
  error: string;
  code?: string;
}
