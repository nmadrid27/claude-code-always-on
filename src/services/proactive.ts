/**
 * Proactive Check-In Service
 *
 * Runs periodic checks and sends intelligent, time-aware notifications:
 *   - Morning briefing (8-9am): Goals summary, upcoming deadlines
 *   - Deadline alerts: Real-time alerts for approaching/overdue goals
 *   - Evening summary (9-10pm): Today's activity recap
 *   - Follow-ups: Reconnects on topics from previous conversations
 *
 * The service runs every 15 minutes and uses time-of-day awareness
 * to decide what kind of notification to send. It tracks what has
 * already been sent per user per day to avoid spamming.
 */

import { Bot } from "grammy";
import { getGoalService } from "./goals.js";
import { invokeClaudeCode } from "../relay.js";
import { getAllowedUserIds } from "../middleware/auth.js";
import { getSupabaseClient } from "../database/supabase.js";
import { getActiveGoals } from "../database/goals.js";
import { getMessagesInRange, getRecentMessages } from "../database/messages.js";
import { getUserFacts } from "../database/user-facts.js";
import { createLogger } from "./logger.js";
import type { GoalRow } from "../database/supabase.js";
import type { ApproachingDeadline } from "./goals.js";

const log = createLogger("proactive");

// ============================================================================
// TYPES
// ============================================================================

interface NotificationDecision {
  shouldNotify: boolean;
  message: string;
}

/** Tracks what notifications have been sent per user per day */
interface DailyState {
  date: string; // YYYY-MM-DD
  morningBriefingSent: boolean;
  eveningSummarySent: boolean;
  deadlineAlertsSent: Set<string>; // goal IDs already alerted
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Check-in interval: 15 minutes */
const CHECK_IN_INTERVAL_MS = 15 * 60 * 1000;

/** User timezone — configure to match your location */
const USER_TIMEZONE = process.env.USER_TIMEZONE || "America/Los_Angeles";

/** Morning briefing window */
const MORNING_START_HOUR = 8;
const MORNING_END_HOUR = 9;

/** Evening summary window */
const EVENING_START_HOUR = 21;
const EVENING_END_HOUR = 22;

// ============================================================================
// PROACTIVE SERVICE CLASS
// ============================================================================

export class ProactiveService {
  private bot: Bot;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  /** Per-user daily state tracking */
  private userStates = new Map<number, DailyState>();

  constructor(bot: Bot) {
    this.bot = bot;
  }

  start(): void {
    if (this.isRunning) {
      log.warn("Service is already running");
      return;
    }

    this.isRunning = true;
    log.info("Starting proactive check-in service (every 15 minutes)");

    // Run the first check after a short delay
    setTimeout(() => {
      this.checkIn().catch((error) => {
        log.error("Initial check-in failed", { error: String(error) });
      });
    }, 15000); // 15 second startup delay

    this.intervalHandle = setInterval(() => {
      this.checkIn().catch((error) => {
        log.error("Periodic check-in failed", { error: String(error) });
      });
    }, CHECK_IN_INTERVAL_MS);
  }

  stop(): void {
    if (!this.isRunning) return;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.isRunning = false;
    log.info("Proactive check-in service stopped");
  }

  // ==========================================================================
  // MAIN CHECK-IN LOOP
  // ==========================================================================

  async checkIn(): Promise<void> {
    const userIds = getAllowedUserIds();
    if (userIds.length === 0) return;

    const now = getUserLocalTime();
    const hour = now.getHours();

    for (const userId of userIds) {
      try {
        const state = this.getDailyState(userId);

        // Morning briefing (8-9am, once per day)
        if (hour >= MORNING_START_HOUR && hour < MORNING_END_HOUR && !state.morningBriefingSent) {
          await this.sendMorningBriefing(userId, state);
        }

        // Deadline checks (always active)
        await this.checkDeadlines(userId, state);

        // Evening summary (9-10pm, once per day)
        if (hour >= EVENING_START_HOUR && hour < EVENING_END_HOUR && !state.eveningSummarySent) {
          await this.sendEveningSummary(userId, state);
        }
      } catch (error) {
        log.error("Check-in failed for user", { userId, error: String(error) });
      }
    }
  }

  // ==========================================================================
  // MORNING BRIEFING
  // ==========================================================================

  private async sendMorningBriefing(userId: number, state: DailyState): Promise<void> {
    const client = getSupabaseClient();

    const [goals, facts] = await Promise.all([
      getActiveGoals(client, userId).catch(() => [] as GoalRow[]),
      getUserFacts(client, userId, undefined, 5).catch(() => []),
    ]);

    // Don't send if there's nothing to brief on
    if (goals.length === 0) {
      state.morningBriefingSent = true;
      return;
    }

    const goalService = getGoalService();
    const deadlines = await goalService.checkDeadlines().catch(() => []);
    const userDeadlines = deadlines.filter((d) => d.goal.telegram_user_id === userId);

    // Build briefing
    const now = getUserLocalTime();
    const dayName = now.toLocaleDateString("en-US", { weekday: "long" });

    let briefing = `Good morning! Here's your ${dayName} briefing:\n\n`;

    // Goals section
    briefing += `*Active Goals (${goals.length}):*\n`;
    for (const g of goals.slice(0, 5)) {
      const priority = g.priority >= 8 ? "!!" : g.priority >= 5 ? "!" : "";
      briefing += `${priority} ${g.title}`;
      if (g.category) briefing += ` [${g.category}]`;
      briefing += "\n";
    }
    if (goals.length > 5) {
      briefing += `_...and ${goals.length - 5} more_\n`;
    }

    // Deadlines section
    if (userDeadlines.length > 0) {
      briefing += `\n*Upcoming Deadlines:*\n`;
      for (const d of userDeadlines) {
        briefing += `- ${d.goal.title}: ${d.timeRemaining}\n`;
      }
    }

    // Fun fact / context
    if (facts.length > 0) {
      const randomFact = facts[Math.floor(Math.random() * facts.length)]!;
      briefing += `\n_Quick reminder: ${randomFact.fact_text}_`;
    }

    briefing += "\n\nWhat's the plan for today?";

    await this.sendNotification(userId, briefing);
    state.morningBriefingSent = true;
    log.info("Morning briefing sent", { userId });
  }

  // ==========================================================================
  // EVENING SUMMARY
  // ==========================================================================

  private async sendEveningSummary(userId: number, state: DailyState): Promise<void> {
    const client = getSupabaseClient();

    // Get today's messages
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const todayMessages = await getMessagesInRange(client, userId, startOfDay, now).catch(() => []);
    const userMessages = todayMessages.filter((m) => m.role === "user");

    // Don't send if the user wasn't active today
    if (userMessages.length === 0) {
      state.eveningSummarySent = true;
      return;
    }

    // Use Claude to generate a natural summary
    const messagePreview = userMessages
      .slice(0, 10)
      .map((m) => m.content.substring(0, 100))
      .join("\n");

    const prompt = `You are summarizing today's conversation for the user in a brief, friendly evening message.
Here are the topics discussed today (${userMessages.length} messages):

${messagePreview}

Write a 2-3 sentence evening wrap-up. Be warm and casual. Mention 1-2 key topics.
Keep it under 200 characters. Do NOT use a greeting — just the summary content.`;

    try {
      const response = await invokeClaudeCode({
        prompt,
        allowedTools: ["read"],
        timeout: 30000,
        maxOutputLength: 500,
      });

      if (response.success && response.output) {
        const summary = `*Evening wrap-up:*\n\n${response.output.trim()}\n\nSleep well — I'll be here tomorrow.`;
        await this.sendNotification(userId, summary);
      }
    } catch (error) {
      // Fallback to simple summary
      const summary = `*Evening wrap-up:*\n\nWe had ${userMessages.length} exchanges today. Rest up — I'll be here tomorrow.`;
      await this.sendNotification(userId, summary);
    }

    state.eveningSummarySent = true;
    log.info("Evening summary sent", { userId, messageCount: userMessages.length });
  }

  // ==========================================================================
  // DEADLINE CHECKS
  // ==========================================================================

  private async checkDeadlines(userId: number, state: DailyState): Promise<void> {
    const goalService = getGoalService();
    const deadlines = await goalService.checkDeadlines().catch(() => []);
    const userDeadlines = deadlines.filter((d) => d.goal.telegram_user_id === userId);

    if (userDeadlines.length === 0) return;

    // Filter to only deadlines we haven't already alerted about
    const newAlerts = userDeadlines.filter(
      (d) => !state.deadlineAlertsSent.has(d.goal.id) && d.minutesUntilDeadline <= 30,
    );

    if (newAlerts.length === 0) return;

    const lines = newAlerts.map((d) => {
      if (d.minutesUntilDeadline < 0) {
        return `- "${d.goal.title}" is ${d.timeRemaining}`;
      }
      return `- "${d.goal.title}" — ${d.timeRemaining}`;
    });

    const message =
      "Heads up on your deadlines:\n\n" +
      lines.join("\n") +
      "\n\nNeed help with any of these?";

    await this.sendNotification(userId, message);

    // Mark as alerted
    for (const d of newAlerts) {
      state.deadlineAlertsSent.add(d.goal.id);
    }

    log.info("Deadline alerts sent", { userId, count: newAlerts.length });
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Gets or creates the daily state for a user.
   * Resets automatically when the date changes.
   */
  private getDailyState(userId: number): DailyState {
    const today = getUserLocalTime().toISOString().split("T")[0]!;
    const existing = this.userStates.get(userId);

    if (existing && existing.date === today) {
      return existing;
    }

    // New day — reset state
    const state: DailyState = {
      date: today,
      morningBriefingSent: false,
      eveningSummarySent: false,
      deadlineAlertsSent: new Set(),
    };
    this.userStates.set(userId, state);
    return state;
  }

  /**
   * Sends a notification message via Telegram.
   * Tries Markdown first, falls back to plain text.
   */
  private async sendNotification(userId: number, message: string): Promise<void> {
    try {
      try {
        await this.bot.api.sendMessage(userId, message, { parse_mode: "Markdown" });
      } catch {
        await this.bot.api.sendMessage(userId, message);
      }
      log.info("Notification sent", { userId });
    } catch (error) {
      log.error("Failed to send notification", { userId, error: String(error) });
    }
  }
}

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Gets the current time in the user's timezone.
 */
function getUserLocalTime(): Date {
  const now = new Date();
  const localStr = now.toLocaleString("en-US", { timeZone: USER_TIMEZONE });
  return new Date(localStr);
}

// ============================================================================
// SINGLETON
// ============================================================================

let proactiveServiceInstance: ProactiveService | null = null;

export function getProactiveService(bot?: Bot): ProactiveService {
  if (!proactiveServiceInstance) {
    if (!bot) {
      throw new Error("Bot instance is required to create ProactiveService");
    }
    proactiveServiceInstance = new ProactiveService(bot);
  }
  return proactiveServiceInstance;
}
