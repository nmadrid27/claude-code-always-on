/**
 * Goal Service
 *
 * Provides goal detection from natural language messages using Claude Code,
 * and manages goal lifecycle (create, read, update) via the database layer.
 *
 * Goal detection examples:
 *   "Finish video by 5pm" -> { description: "Finish the video", deadline: "today 5pm" }
 *   "Call mom tomorrow at 3" -> { description: "Call mom", deadline: "tomorrow 3pm" }
 */

import { invokeClaudeCode } from "../relay.js";
import {
  createGoal,
  getActiveGoals as dbGetActiveGoals,
  getAllActiveGoals as dbGetAllActiveGoals,
  updateGoalStatus as dbUpdateGoalStatus,
} from "../database/goals.js";
import { getSupabaseClient } from "../database/supabase.js";
import type { GoalRow } from "../database/supabase.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * A goal detected from natural language input
 */
export interface DetectedGoal {
  /** Human-readable description of the goal */
  description: string;

  /** Deadline string in natural language (e.g., "today 5pm", "tomorrow 3pm") */
  deadline: string | null;

  /** Priority from 1-10, inferred from urgency cues */
  priority: number;

  /** Optional category inferred from content */
  category: string | null;
}

/**
 * A goal with an approaching deadline
 */
export interface ApproachingDeadline {
  /** The goal row from the database */
  goal: GoalRow;

  /** How many minutes until the deadline */
  minutesUntilDeadline: number;

  /** Human-readable time remaining string */
  timeRemaining: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const LOG_PREFIX = "[goals]";

/** Prompt for Claude Code to detect goals from natural language */
const GOAL_DETECTION_PROMPT = `You are a goal detection system. Analyze the following user message and extract any goals, tasks, or commitments the user is expressing.

For each goal found, return a JSON array with objects containing:
- "description": A clear, concise description of the goal/task
- "deadline": The deadline in ISO 8601 format if mentioned (use today's date as reference: CURRENT_DATE), or null if no deadline
- "priority": A number from 1-10 based on urgency cues (default 5)
- "category": A short category label (e.g., "personal", "work", "health", "errands") or null

If the message does NOT contain any goals, tasks, or commitments, return an empty array: []

Do NOT detect goals from:
- Questions about existing goals
- General conversation or greetings
- Past tense statements about completed tasks
- Hypothetical or conditional statements

IMPORTANT: Return ONLY the JSON array, no other text or markdown formatting.

User message: "MESSAGE_CONTENT"`;

// ============================================================================
// GOAL SERVICE CLASS
// ============================================================================

export class GoalService {
  /**
   * Detects goals from a natural language message using Claude Code.
   *
   * @param message - The user's message text
   * @returns Array of detected goals (empty if none found)
   */
  async detectGoals(message: string): Promise<DetectedGoal[]> {
    // Skip very short messages or obvious non-goal messages
    if (message.length < 5) {
      return [];
    }

    // Skip messages that start with "/" (commands)
    if (message.startsWith("/")) {
      return [];
    }

    const currentDate = new Date().toISOString();
    const prompt = GOAL_DETECTION_PROMPT
      .replace("CURRENT_DATE", currentDate)
      .replace("MESSAGE_CONTENT", message.replace(/"/g, '\\"'));

    try {
      const response = await invokeClaudeCode({
        prompt,
        timeout: 30000, // 30 seconds for goal detection
        maxOutputLength: 2000,
      });

      if (!response.success || !response.output) {
        console.error(`${LOG_PREFIX} Goal detection failed:`, response.error);
        return [];
      }

      // Parse the JSON response from Claude
      const parsed = this.parseGoalResponse(response.output);
      return parsed;
    } catch (error) {
      console.error(`${LOG_PREFIX} Error detecting goals:`, error);
      return [];
    }
  }

  /**
   * Creates a goal in the database from a detected goal.
   *
   * @param userId - Telegram user ID
   * @param detected - The detected goal from natural language
   * @returns The created GoalRow or null if creation failed
   */
  async trackGoal(userId: number, detected: DetectedGoal): Promise<GoalRow | null> {
    const client = getSupabaseClient();

    const title = detected.description.length > 100
      ? detected.description.substring(0, 97) + "..."
      : detected.description;

    const goal = await createGoal(
      client,
      userId,
      title,
      detected.description,
      detected.priority,
      detected.category ?? undefined,
    );

    if (goal) {
      console.log(`${LOG_PREFIX} Goal tracked for user ${userId}: "${title}"`);
    }

    return goal;
  }

  /**
   * Returns all active goals for a user.
   *
   * @param userId - Telegram user ID
   * @returns Array of active GoalRow records
   */
  async getActiveGoals(userId: number): Promise<GoalRow[]> {
    const client = getSupabaseClient();
    return dbGetActiveGoals(client, userId);
  }

  /**
   * Updates the status of a goal.
   *
   * @param goalId - The goal's UUID
   * @param status - New status: "active", "completed", or "archived"
   * @returns True if the update succeeded
   */
  async updateGoalStatus(
    goalId: string,
    status: "active" | "completed" | "archived",
  ): Promise<boolean> {
    const client = getSupabaseClient();
    return dbUpdateGoalStatus(client, goalId, status);
  }

  /**
   * Checks for goals with approaching deadlines across all users.
   * A deadline is "approaching" if it is within the next 60 minutes
   * or has just passed within the last 15 minutes.
   *
   * @returns Array of goals with approaching deadlines
   */
  async checkDeadlines(): Promise<ApproachingDeadline[]> {
    const client = getSupabaseClient();
    const approaching: ApproachingDeadline[] = [];

    // All active goals across users (deadlines are stored in goal metadata)
    const activeGoals = await dbGetAllActiveGoals(client);

    if (activeGoals.length === 0) {
      return [];
    }

    const now = new Date();

    for (const goal of activeGoals as GoalRow[]) {
      // Check if goal has a deadline stored in metadata
      const deadline = goal.metadata?.deadline as string | undefined;
      if (!deadline) continue;

      try {
        const deadlineDate = new Date(deadline);
        if (isNaN(deadlineDate.getTime())) continue;

        const diffMs = deadlineDate.getTime() - now.getTime();
        const diffMinutes = Math.round(diffMs / (1000 * 60));

        // Include goals with deadlines in the next 60 minutes
        // or that passed within the last 15 minutes
        if (diffMinutes <= 60 && diffMinutes >= -15) {
          approaching.push({
            goal,
            minutesUntilDeadline: diffMinutes,
            timeRemaining: this.formatTimeRemaining(diffMinutes),
          });
        }
      } catch {
        // Skip goals with unparseable deadlines
        continue;
      }
    }

    // Sort by closest deadline first
    approaching.sort((a, b) => a.minutesUntilDeadline - b.minutesUntilDeadline);

    return approaching;
  }

  /**
   * Formats all active goals into a readable string for Telegram display.
   *
   * @param goals - Array of goal rows
   * @returns Formatted string of goals
   */
  formatGoalsList(goals: GoalRow[]): string {
    if (goals.length === 0) {
      return "You don't have any active goals right now. Just tell me what you want to accomplish and I'll track it for you!";
    }

    const lines: string[] = ["Your active goals:\n"];

    for (let i = 0; i < goals.length; i++) {
      const goal = goals[i]!;
      const priorityEmoji = goal.priority >= 8 ? "🔴" : goal.priority >= 5 ? "🟡" : "🟢";
      const categoryTag = goal.category ? ` [${goal.category}]` : "";
      const deadline = goal.metadata?.deadline as string | undefined;
      const deadlineStr = deadline
        ? ` (due: ${new Date(deadline).toLocaleString()})`
        : "";

      lines.push(
        `${i + 1}. ${priorityEmoji} ${goal.title}${categoryTag}${deadlineStr}`,
      );
    }

    return lines.join("\n");
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Parses the raw Claude Code response into DetectedGoal objects.
   */
  private parseGoalResponse(output: string): DetectedGoal[] {
    try {
      // Strip any markdown code block wrappers
      let cleaned = output.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();

      // Find the JSON array in the output
      const startIdx = cleaned.indexOf("[");
      const endIdx = cleaned.lastIndexOf("]");
      if (startIdx === -1 || endIdx === -1) {
        return [];
      }

      const jsonStr = cleaned.substring(startIdx, endIdx + 1);
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter(
          (item: unknown) =>
            typeof item === "object" &&
            item !== null &&
            "description" in item &&
            typeof (item as Record<string, unknown>).description === "string",
        )
        .map((item: Record<string, unknown>) => ({
          description: item.description as string,
          deadline: typeof item.deadline === "string" ? item.deadline : null,
          priority:
            typeof item.priority === "number"
              ? Math.max(1, Math.min(10, item.priority))
              : 5,
          category:
            typeof item.category === "string" ? item.category : null,
        }));
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to parse goal response:`, error);
      console.error(`${LOG_PREFIX} Raw output:`, output.substring(0, 200));
      return [];
    }
  }

  /**
   * Formats a number of minutes into a human-readable time remaining string.
   */
  private formatTimeRemaining(minutes: number): string {
    if (minutes < 0) {
      const overdue = Math.abs(minutes);
      if (overdue < 60) return `${overdue}m overdue`;
      return `${Math.floor(overdue / 60)}h ${overdue % 60}m overdue`;
    }

    if (minutes === 0) return "due now";
    if (minutes < 60) return `${minutes}m remaining`;

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m remaining` : `${hours}h remaining`;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let goalServiceInstance: GoalService | null = null;

/**
 * Returns the singleton GoalService instance.
 */
export function getGoalService(): GoalService {
  if (!goalServiceInstance) {
    goalServiceInstance = new GoalService();
  }
  return goalServiceInstance;
}
