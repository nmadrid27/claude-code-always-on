/**
 * Context Builder Service
 *
 * Assembles rich prompts for Claude Code by combining:
 * - System prompt defining assistant personality
 * - Recent conversation history from Supabase
 * - Semantically relevant past messages (pgvector)
 * - Active goals and user facts
 *
 * This is the core of what makes the bot feel like a real assistant
 * rather than a stateless relay.
 */

import {
  getSupabaseClient,
  type MessageRow,
  type GoalRow,
  type UserFactRow,
} from "../database/supabase.js";
import { getRecentMessages, searchSimilarMessages } from "../database/messages.js";
import { getActiveGoals } from "../database/goals.js";
import { getUserFacts } from "../database/user-facts.js";
import { storeMessage } from "../database/messages.js";
import { createLogger } from "./logger.js";

const log = createLogger("context");

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are Nathan's personal AI assistant, available 24/7 through Telegram. Your name is PopPop (the bot's Telegram handle).

## Who You Are
- You're warm, direct, and genuinely helpful — like a sharp friend who happens to know everything
- You remember past conversations and bring up relevant context naturally
- You're proactive: if you notice a connection to something Nathan mentioned before, say so
- You keep responses concise for Telegram (short paragraphs, use bullet points)
- You use casual language but stay substantive — no filler

## What You Can Do
- Answer questions using Claude Code's full capabilities (file access, code execution, web search)
- Track goals and tasks automatically when Nathan mentions them
- Remember preferences, facts, and context across conversations
- Analyze photos, documents, and files
- Run commands and code on Nathan's local machine

## How You Behave
- If Nathan says something that implies a task or goal, acknowledge it naturally (don't be robotic about "Goal detected!")
- When you remember something relevant from a past conversation, weave it in naturally: "You mentioned last week that..."
- If you're unsure about something, say so rather than guessing
- For code or technical output, use markdown code blocks
- Keep most responses under 300 words unless the topic needs depth

## Current Context
CURRENT_TIME_BLOCK
GOALS_BLOCK
FACTS_BLOCK
MEMORY_BLOCK
CONVERSATION_BLOCK`;

// ============================================================================
// CONTEXT BUILDER
// ============================================================================

export interface BuiltContext {
  /** The full prompt to send to Claude Code */
  prompt: string;
  /** Number of conversation messages included */
  conversationLength: number;
  /** Number of semantic memory results included */
  memoryHits: number;
}

/**
 * Builds a rich prompt with full context for a user message.
 */
export async function buildContext(
  userId: number,
  userMessage: string,
): Promise<BuiltContext> {
  const client = getSupabaseClient();

  // Fetch all context in parallel
  const [recentResult, goals, facts, semanticHits] = await Promise.all([
    getRecentMessages(client, userId, 15).catch(() => ({ messages: [], hasMore: false })),
    getActiveGoals(client, userId).catch(() => [] as GoalRow[]),
    getUserFacts(client, userId, undefined, 3).catch(() => [] as UserFactRow[]),
    searchSemanticMemory(client, userId, userMessage),
  ]);

  const recentMessages = recentResult.messages;

  // Build context blocks
  const timeBlock = `Current time: ${new Date().toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  })}`;

  const goalsBlock = goals.length > 0
    ? `Nathan's active goals:\n${goals.map((g) => `- ${g.title}${g.category ? ` [${g.category}]` : ""} (priority: ${g.priority}/10)`).join("\n")}`
    : "No active goals tracked.";

  const factsBlock = facts.length > 0
    ? `Known facts about Nathan:\n${facts.map((f) => `- [${f.fact_type}] ${f.fact_text}`).join("\n")}`
    : "";

  const memoryBlock = semanticHits.length > 0
    ? `Relevant past context (from earlier conversations):\n${semanticHits.map((m) => `- [${m.role}]: ${m.content.substring(0, 200)}`).join("\n")}`
    : "";

  // Build conversation history (chronological order, most recent last)
  const conversationBlock = recentMessages.length > 0
    ? `Recent conversation:\n${[...recentMessages].reverse().map((m) => `[${m.role}]: ${m.content.substring(0, 500)}`).join("\n")}`
    : "This is the start of the conversation.";

  // Assemble the full system prompt
  const systemPrompt = SYSTEM_PROMPT
    .replace("CURRENT_TIME_BLOCK", timeBlock)
    .replace("GOALS_BLOCK", goalsBlock)
    .replace("FACTS_BLOCK", factsBlock)
    .replace("MEMORY_BLOCK", memoryBlock)
    .replace("CONVERSATION_BLOCK", conversationBlock);

  // Final prompt: system context + current message
  const prompt = `${systemPrompt}\n\n---\n\nNathan's message: ${userMessage}`;

  return {
    prompt,
    conversationLength: recentMessages.length,
    memoryHits: semanticHits.length,
  };
}

/**
 * Search for semantically relevant past messages.
 * Gracefully degrades if embeddings/pgvector aren't available.
 */
async function searchSemanticMemory(
  client: ReturnType<typeof getSupabaseClient>,
  userId: number,
  query: string,
): Promise<Array<{ role: string; content: string }>> {
  try {
    // Only attempt if OpenAI key is configured
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === "your_openai_api_key_here") {
      return [];
    }

    const { generateEmbedding } = await import("./embeddings.js");
    const embedding = await generateEmbedding(query, { apiKey });
    const results = await searchSimilarMessages(client, embedding, userId, 5, 0.72);

    return results.map((r) => ({ role: r.role, content: r.content }));
  } catch (error) {
    log.debug("Semantic search unavailable", { error: String(error) });
    return [];
  }
}

// ============================================================================
// MESSAGE STORAGE
// ============================================================================

/**
 * Stores a user message in the database with optional async embedding.
 */
export async function storeUserMessage(
  userId: number,
  content: string,
  telegramMessageId?: number,
): Promise<void> {
  try {
    const client = getSupabaseClient();
    await storeMessage(client, userId, "user", content, undefined, undefined, telegramMessageId);

    // Generate embedding asynchronously
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && apiKey !== "your_openai_api_key_here") {
      generateAndStoreEmbedding(client, userId, content).catch((err) => {
        log.debug("Embedding generation failed", { error: String(err) });
      });
    }
  } catch (error) {
    log.warn("Failed to store user message", { error: String(error) });
  }
}

/**
 * Stores an assistant response in the database.
 */
export async function storeAssistantMessage(
  userId: number,
  content: string,
): Promise<void> {
  try {
    const client = getSupabaseClient();
    await storeMessage(client, userId, "assistant", content);
  } catch (error) {
    log.warn("Failed to store assistant message", { error: String(error) });
  }
}

/**
 * Generate embedding for the most recent user message and update it.
 */
async function generateAndStoreEmbedding(
  client: ReturnType<typeof getSupabaseClient>,
  userId: number,
  content: string,
): Promise<void> {
  const { generateEmbedding } = await import("./embeddings.js");
  const apiKey = process.env.OPENAI_API_KEY!;
  const embedding = await generateEmbedding(content, { apiKey });

  // Find the most recent message for this user and update its embedding
  const { data } = await client
    .from("messages")
    .select("id")
    .eq("telegram_user_id", userId)
    .eq("content", content)
    .order("created_at", { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const row = data[0] as { id: string };
    await client
      .from("messages")
      .update({ embedding })
      .eq("id", row.id);
  }
}
