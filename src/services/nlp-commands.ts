/**
 * Natural Language Command Handler
 *
 * Detects actionable patterns in user messages and handles them
 * locally without needing a Claude Code invocation. This makes
 * simple commands (reminders, notes, memory queries) feel instant.
 *
 * Patterns:
 *   "remind me to/at/in ..." → creates a goal with deadline
 *   "remember that ..." / "note that ..." → stores a user fact
 *   "what did we talk about ..." → semantic memory search
 *   "forget ..." → removes a stored fact
 */

import { getSupabaseClient } from "../database/supabase.js";
import { upsertUserFact, getUserFacts, deleteFact } from "../database/user-facts.js";
import { createGoal, updateGoalMetadata } from "../database/goals.js";
import { getRecentMessages, getMessagesInRange } from "../database/messages.js";
import { createLogger } from "./logger.js";

const log = createLogger("nlp-commands");

// ============================================================================
// TYPES
// ============================================================================

export interface CommandResult {
  /** Whether a local command was detected and handled */
  handled: boolean;
  /** The response message to send back (if handled) */
  response?: string;
}

// ============================================================================
// PATTERN MATCHERS
// ============================================================================

const REMINDER_PATTERNS = [
  /^remind me (?:to |that )?(.+?)(?:\s+(?:at|by|on|before)\s+(.+))?$/i,
  /^set (?:a )?reminder[: ]+(.+?)(?:\s+(?:at|by|on|before)\s+(.+))?$/i,
  /^don'?t let me forget (?:to )?(.+)$/i,
];

const NOTE_PATTERNS = [
  /^(?:remember|note|save|store)(?: that)?\s+(.+)/i,
  /^(?:keep in mind|fyi|btw)[,:]?\s+(.+)/i,
];

const MEMORY_QUERY_PATTERNS = [
  /^what did (?:we|I) (?:talk|chat|discuss) about\s*(.*)$/i,
  /^what did I (?:say|mention|tell you) about\s+(.+)$/i,
  /^do you remember (?:when|what)\s+(.+)$/i,
  /^search (?:my )?(?:memory|history|conversations?) (?:for |about )?(.+)$/i,
];

const FORGET_PATTERNS = [
  /^forget (?:about |that )?(.+)/i,
  /^(?:delete|remove) (?:the )?(?:fact|note|memory)(?: about)?\s+(.+)/i,
];

const SUMMARY_PATTERNS = [
  /^(?:what happened|catch me up|summary|daily summary|today'?s? summary)$/i,
  /^what (?:did we do|happened) today\??$/i,
];

// ============================================================================
// COMMAND HANDLER
// ============================================================================

/**
 * Attempts to detect and handle a natural language command.
 * Returns { handled: false } if no pattern matches, allowing
 * the message to fall through to Claude Code.
 */
export async function handleNLPCommand(
  userId: number,
  message: string,
): Promise<CommandResult> {
  const trimmed = message.trim();

  // Try each pattern category
  const handlers: Array<() => Promise<CommandResult>> = [
    () => tryReminder(userId, trimmed),
    () => tryNote(userId, trimmed),
    () => tryMemoryQuery(userId, trimmed),
    () => tryForget(userId, trimmed),
    () => trySummary(userId, trimmed),
  ];

  for (const handler of handlers) {
    const result = await handler();
    if (result.handled) {
      log.info("NLP command handled", { userId, type: handler.name });
      return result;
    }
  }

  return { handled: false };
}

// ============================================================================
// INDIVIDUAL HANDLERS
// ============================================================================

async function tryReminder(userId: number, text: string): Promise<CommandResult> {
  for (const pattern of REMINDER_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const task = match[1]!.trim();
    const timeHint = match[2]?.trim();

    const client = getSupabaseClient();

    // Parse a simple deadline if time hint is provided
    const deadline = timeHint ? parseTimeHint(timeHint) : undefined;

    const metadata: Record<string, unknown> = { source: "reminder" };
    if (deadline) {
      metadata.deadline = deadline.toISOString();
    }

    const goal = await createGoal(
      client,
      userId,
      task,
      `Reminder: ${task}`,
      7, // reminders default to priority 7
      "reminder",
    );

    if (!goal) {
      return { handled: true, response: "Sorry, I couldn't save that reminder. Try again?" };
    }

    // Update metadata with deadline if we have one
    if (deadline) {
      await updateGoalMetadata(client, goal.id, metadata);
    }

    const timeStr = deadline
      ? ` I'll flag it around ${deadline.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
      : "";

    return {
      handled: true,
      response: `Got it — I'll remind you to *${task}*.${timeStr}`,
    };
  }

  return { handled: false };
}

async function tryNote(userId: number, text: string): Promise<CommandResult> {
  for (const pattern of NOTE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const factText = match[1]!.trim();

    if (factText.length < 3) {
      return { handled: true, response: "That's a bit short to save. Can you add more detail?" };
    }

    const client = getSupabaseClient();
    const result = await upsertUserFact(
      client,
      userId,
      "context",
      factText,
      7,
      "user_note",
    );

    if (!result) {
      return { handled: true, response: "Sorry, I couldn't save that note." };
    }

    return {
      handled: true,
      response: `Noted. I'll remember that: *${factText}*`,
    };
  }

  return { handled: false };
}

async function tryMemoryQuery(userId: number, text: string): Promise<CommandResult> {
  for (const pattern of MEMORY_QUERY_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const query = match[1]?.trim();

    if (!query || query.length < 2) {
      // General "what did we talk about?" — return recent conversation topics
      return await getRecentTopicsSummary(userId);
    }

    // Try semantic search first
    const apiKey = process.env.VOYAGE_API_KEY;
    if (apiKey) {
      try {
        const { generateEmbedding } = await import("./embeddings.js");
        const { searchSimilarMessages } = await import("../database/messages.js");
        const client = getSupabaseClient();
        const embedding = await generateEmbedding(query, { apiKey });
        const results = await searchSimilarMessages(client, embedding, userId, 5, 0.65);

        if (results.length > 0) {
          const formatted = results
            .map((r, i) => `${i + 1}. *${r.role}*: ${r.content.substring(0, 150)}${r.content.length > 150 ? "..." : ""}`)
            .join("\n");

          return {
            handled: true,
            response: `Here's what I found about "${query}":\n\n${formatted}`,
          };
        }
      } catch {
        // Fall through to basic search
      }
    }

    // Fallback: basic keyword search in recent messages
    return await getRecentTopicsSummary(userId, query);
  }

  return { handled: false };
}

async function tryForget(userId: number, text: string): Promise<CommandResult> {
  for (const pattern of FORGET_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const target = match[1]!.trim().toLowerCase();
    const client = getSupabaseClient();

    // Search existing facts for a match
    const facts = await getUserFacts(client, userId);
    const matching = facts.filter((f) =>
      f.fact_text.toLowerCase().includes(target),
    );

    if (matching.length === 0) {
      return {
        handled: true,
        response: `I don't have any notes about "${target}".`,
      };
    }

    // Delete matching facts
    let deleted = 0;
    for (const fact of matching) {
      if (await deleteFact(client, fact.id)) {
        deleted++;
      }
    }

    return {
      handled: true,
      response: `Done — I forgot ${deleted} note${deleted === 1 ? "" : "s"} about "${target}".`,
    };
  }

  return { handled: false };
}

async function trySummary(userId: number, text: string): Promise<CommandResult> {
  for (const pattern of SUMMARY_PATTERNS) {
    if (!pattern.test(text)) continue;

    const client = getSupabaseClient();

    // Get today's messages
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const todayMessages = await getMessagesInRange(client, userId, startOfDay, now);
    const userMessages = todayMessages.filter((m) => m.role === "user");

    if (userMessages.length === 0) {
      return {
        handled: true,
        response: "We haven't chatted today yet. What's on your mind?",
      };
    }

    // Build a simple summary
    const topics = userMessages
      .map((m) => m.content.substring(0, 80))
      .slice(0, 10);

    const topicList = topics
      .map((t, i) => `${i + 1}. ${t}${t.length >= 80 ? "..." : ""}`)
      .join("\n");

    return {
      handled: true,
      response:
        `*Today's conversation* (${userMessages.length} messages):\n\n${topicList}\n\n` +
        `_Ask me anything to dive deeper into a topic._`,
    };
  }

  return { handled: false };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Parses simple time hints into a Date.
 * Handles: "in 30 minutes", "in 2 hours", "at 3pm", "tomorrow", "tomorrow at 9am"
 */
function parseTimeHint(hint: string): Date | undefined {
  const now = new Date();

  // "in X minutes/hours/days"
  const relativeMatch = hint.match(/^in\s+(\d+)\s+(minute|min|hour|hr|day)s?$/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]!, 10);
    const unit = relativeMatch[2]!.toLowerCase();
    const date = new Date(now);

    if (unit.startsWith("min")) date.setMinutes(date.getMinutes() + amount);
    else if (unit.startsWith("h")) date.setHours(date.getHours() + amount);
    else if (unit.startsWith("d")) date.setDate(date.getDate() + amount);

    return date;
  }

  // "at Xpm/am" or "at X:XX pm/am"
  const atTimeMatch = hint.match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (atTimeMatch) {
    let hours = parseInt(atTimeMatch[1]!, 10);
    const minutes = atTimeMatch[2] ? parseInt(atTimeMatch[2], 10) : 0;
    const period = atTimeMatch[3]?.toLowerCase();

    if (period === "pm" && hours < 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;

    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);

    // If the time has already passed today, assume tomorrow
    if (date <= now) {
      date.setDate(date.getDate() + 1);
    }
    return date;
  }

  // "tomorrow" or "tomorrow at X"
  const tomorrowMatch = hint.match(/^tomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (tomorrowMatch) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);

    if (tomorrowMatch[1]) {
      let hours = parseInt(tomorrowMatch[1], 10);
      const minutes = tomorrowMatch[2] ? parseInt(tomorrowMatch[2], 10) : 0;
      const period = tomorrowMatch[3]?.toLowerCase();
      if (period === "pm" && hours < 12) hours += 12;
      if (period === "am" && hours === 12) hours = 0;
      date.setHours(hours, minutes, 0, 0);
    } else {
      date.setHours(9, 0, 0, 0); // Default: tomorrow at 9am
    }
    return date;
  }

  return undefined;
}

/**
 * Gets a summary of recent conversation topics.
 */
async function getRecentTopicsSummary(
  userId: number,
  keyword?: string,
): Promise<CommandResult> {
  const client = getSupabaseClient();
  const { messages } = await getRecentMessages(client, userId, 20);

  if (messages.length === 0) {
    return {
      handled: true,
      response: "I don't have any conversation history with you yet.",
    };
  }

  let filtered = messages.filter((m) => m.role === "user");

  if (keyword) {
    const lowerKeyword = keyword.toLowerCase();
    filtered = filtered.filter((m) =>
      m.content.toLowerCase().includes(lowerKeyword),
    );

    if (filtered.length === 0) {
      return {
        handled: true,
        response: `I couldn't find any messages about "${keyword}" in your recent history.`,
      };
    }
  }

  const topics = filtered
    .slice(0, 8)
    .map((m, i) => {
      const preview = m.content.substring(0, 100);
      return `${i + 1}. ${preview}${m.content.length > 100 ? "..." : ""}`;
    })
    .join("\n");

  const title = keyword
    ? `Messages about "${keyword}"`
    : "Recent conversation topics";

  return {
    handled: true,
    response: `*${title}:*\n\n${topics}`,
  };
}
