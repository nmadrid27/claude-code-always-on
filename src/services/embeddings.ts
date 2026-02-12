/**
 * OpenAI Embeddings Service
 *
 * Generates embeddings using OpenAI's text-embedding-3-large model.
 * This model produces 3072-dimensional vectors optimized for semantic search.
 *
 * API Key Security:
 * The OPENAI_API_KEY should be stored securely and accessed via environment variable.
 * For production use, consider using Supabase Edge Functions to keep keys secure.
 */

/**
 * OpenAI embedding response structure
 */
interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Configuration for embedding requests
 */
export interface EmbeddingConfig {
  apiKey: string;
  model?: "text-embedding-3-small" | "text-embedding-3-large";
  baseURL?: string;
}

/**
 * Default embedding model
 * text-embedding-3-large produces 3072-dimensional vectors with high quality
 */
const DEFAULT_MODEL = "text-embedding-3-large";

/**
 * Expected dimensions for each model
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
};

/**
 * Generates an embedding for a single text string
 *
 * @param text - Text to embed
 * @param config - Embedding configuration
 * @returns Embedding vector
 * @throws Error if API request fails
 */
export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<number[]> {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  const model = config.model ?? DEFAULT_MODEL;
  const baseURL = config.baseURL ?? "https://api.openai.com/v1";

  const response = await fetch(`${baseURL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  const data = (await response.json()) as OpenAIEmbeddingResponse;

  if (!data.data?.[0]?.embedding) {
    throw new Error("Invalid response from OpenAI API");
  }

  return data.data[0].embedding;
}

/**
 * Generates embeddings for multiple texts in a single batch request
 * More efficient than calling generateEmbedding multiple times
 *
 * @param texts - Array of texts to embed
 * @param config - Embedding configuration
 * @returns Array of embedding vectors
 * @throws Error if API request fails
 */
export async function generateEmbeddings(
  texts: string[],
  config: EmbeddingConfig,
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  if (texts.length === 1) {
    return [await generateEmbedding(texts[0]!, config)];
  }

  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  const model = config.model ?? DEFAULT_MODEL;
  const baseURL = config.baseURL ?? "https://api.openai.com/v1";

  const response = await fetch(`${baseURL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  const data = (await response.json()) as OpenAIEmbeddingResponse;

  // Sort results by index to ensure order matches input
  const sorted = [...data.data].sort((a, b) => a.index - b.index);

  return sorted.map((item) => item.embedding);
}

/**
 * Calculates cosine similarity between two vectors
 * Useful for computing similarity locally without database query
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Similarity score between 0 and 1
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Finds the most similar items from a set of candidates
 *
 * @param query - Query embedding
 * @param candidates - Candidate embeddings with their IDs
 * @param topK - Number of top results to return
 * @returns Array of [id, similarity] pairs sorted by similarity
 */
export function findMostSimilar(
  query: number[],
  candidates: Map<string, number[]>,
  topK = 5,
): Array<{ id: string; similarity: number }> {
  const results: Array<{ id: string; similarity: number }> = [];

  for (const [id, embedding] of candidates) {
    const similarity = cosineSimilarity(query, embedding);
    results.push({ id, similarity });
  }

  // Sort by similarity descending
  results.sort((a, b) => b.similarity - a.similarity);

  // Return top K
  return results.slice(0, topK);
}

/**
 * Gets the expected dimension for a model
 *
 * @param model - Model name
 * @returns Expected vector dimension
 */
export function getModelDimensions(
  model: string = DEFAULT_MODEL,
): number {
  return MODEL_DIMENSIONS[model] ?? MODEL_DIMENSIONS[DEFAULT_MODEL] ?? 3072;
}

/**
 * Validates that a vector has the expected dimensions
 *
 * @param vector - Vector to validate
 * @param model - Expected model
 * @returns True if dimensions match
 */
export function validateDimensions(
  vector: number[],
  model: string = DEFAULT_MODEL,
): boolean {
  const expected = getModelDimensions(model);
  return vector.length === expected;
}

/**
 * Embeddings service class for convenient batch operations
 */
export class EmbeddingsService {
  private config: EmbeddingConfig;

  constructor(config: EmbeddingConfig) {
    this.config = config;
  }

  /**
   * Embed a single text
   */
  async embed(text: string): Promise<number[]> {
    return generateEmbedding(text, this.config);
  }

  /**
   * Embed multiple texts efficiently
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return generateEmbeddings(texts, this.config);
  }

  /**
   * Embed messages for database storage
   */
  async embedMessages(messages: Array<{ role: string; content: string }>): Promise<number[][]> {
    const texts = messages.map((m) => `${m.role}: ${m.content}`);
    return this.embedBatch(texts);
  }

  /**
   * Create a service instance from environment variables
   */
  static fromEnv(): EmbeddingsService {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }

    return new EmbeddingsService({
      apiKey,
      model: DEFAULT_MODEL,
    });
  }
}
