/**
 * Database Module Index
 *
 * Main exports for the semantic memory database system.
 * Combines Supabase storage with OpenAI embeddings for intelligent retrieval.
 */

// Core client
export {
  DatabaseClient,
  createDatabaseClient,
  getDatabaseClient,
  type MemoryConfig,
  type MemorySearchResult,
  type QueryContext,
} from "./client.js";

// Database handle + row types
export {
  getSupabaseClient,
  getSupabaseAdminClient,
  type SupabaseClient,
  type MessageRow,
  type GoalRow,
  type UserFactRow,
  type ConversationContextRow,
  type SimilarMessage,
  type RelevantGoal,
  type RelevantFact,
} from "./supabase.js";

// SQLite connection
export {
  getDb,
  openDatabase,
  closeDb,
  resolveDbPath,
  type BotDatabase,
} from "./sqlite.js";

// Message operations
export {
  storeMessage,
  storeMessages,
  getRecentMessages,
  getMessagesInRange,
  updateMessageEmbedding,
  searchSimilarMessages,
  deleteMessage,
  deleteAllUserMessages,
  getMessageStats,
  getConversationContext,
  type MessagePaginationResult,
} from "./messages.js";

// Goal operations
export {
  createGoal,
  getGoals,
  getActiveGoals,
  updateGoalStatus,
  completeGoal,
  archiveGoal,
  updateGoalEmbedding,
  searchRelevantGoals,
  deleteGoal,
  getGoalsByCategory,
  getGoalCategories,
} from "./goals.js";

// User fact operations
export {
  upsertUserFact,
  getUserFacts,
  getFactsByType,
  searchRelevantFacts,
  updateFactConfidence,
  updateFactEmbedding,
  deleteFact,
  deleteFactsByType,
  getFactsSummary,
  storeInferredFacts,
  type FactType,
} from "./user-facts.js";

// Embeddings service
export {
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  findMostSimilar,
  getModelDimensions,
  validateDimensions,
  EmbeddingsService,
  type EmbeddingConfig,
} from "../services/embeddings.js";
