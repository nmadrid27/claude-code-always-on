/**
 * Voyage AI Embeddings Service
 *
 * Generates embeddings using Voyage AI's voyage-3 model.
 * This model produces 1024-dimensional vectors optimized for semantic search.
 * Voyage AI is Anthropic-backed and designed for retrieval alongside Claude.
 */

/**
 * Voyage AI embedding response structure
 */
interface VoyageEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

/**
 * Configuration for embedding requests
 */
export interface EmbeddingConfig {
  apiKey: string;
  model?: "voyage-3" | "voyage-3-large" | "voyage-3-lite";
  baseURL?: string;
}

/**
 * Default embedding model
 * voyage-3 produces 1024-dimensional vectors with high quality
 */
const DEFAULT_MODEL = "voyage-3";

/**
 * Expected dimensions for each model
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  "voyage-3": 1024,
  "voyage-3-large": 1024,
  "voyage-3-lite": 512,
};

/**
 * Generates an embedding for a single text string
 */
export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<number[]> {
  const apiKey = config.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY environment variable is not set");
  }

  const model = config.model ?? DEFAULT_MODEL;
  const baseURL = config.baseURL ?? "https://api.voyageai.com/v1";

  const response = await fetch(`${baseURL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage AI API error: ${response.status} ${error}`);
  }

  const data = (await response.json()) as VoyageEmbeddingResponse;

  if (!data.data?.[0]?.embedding) {
    throw new Error("Invalid response from Voyage AI API");
  }

  return data.data[0].embedding;
}

/**
 * Generates embeddings for multiple texts in a single batch request
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

  const apiKey = config.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY environment variable is not set");
  }

  const model = config.model ?? DEFAULT_MODEL;
  const baseURL = config.baseURL ?? "https://api.voyageai.com/v1";

  const response = await fetch(`${baseURL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage AI API error: ${response.status} ${error}`);
  }

  const data = (await response.json()) as VoyageEmbeddingResponse;

  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return sorted.map((item) => item.embedding);
}

/**
 * Calculates cosine similarity between two vectors
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

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}

/**
 * Gets the expected dimension for a model
 */
export function getModelDimensions(model: string = DEFAULT_MODEL): number {
  return MODEL_DIMENSIONS[model] ?? MODEL_DIMENSIONS[DEFAULT_MODEL] ?? 1024;
}

/**
 * Validates that a vector has the expected dimensions
 */
export function validateDimensions(
  vector: number[],
  model: string = DEFAULT_MODEL,
): boolean {
  return vector.length === getModelDimensions(model);
}

/**
 * Embeddings service class for convenient batch operations
 */
export class EmbeddingsService {
  private config: EmbeddingConfig;

  constructor(config: EmbeddingConfig) {
    this.config = config;
  }

  async embed(text: string): Promise<number[]> {
    return generateEmbedding(text, this.config);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return generateEmbeddings(texts, this.config);
  }

  async embedMessages(messages: Array<{ role: string; content: string }>): Promise<number[][]> {
    const texts = messages.map((m) => `${m.role}: ${m.content}`);
    return this.embedBatch(texts);
  }

  static fromEnv(): EmbeddingsService {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      throw new Error("VOYAGE_API_KEY environment variable is not set");
    }
    return new EmbeddingsService({ apiKey, model: DEFAULT_MODEL });
  }
}
