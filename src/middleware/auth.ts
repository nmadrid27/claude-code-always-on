import { Context } from "grammy";

/**
 * Security Model:
 *
 * This middleware implements a whitelist-based authorization system for the Telegram bot.
 * Only users whose Telegram IDs are explicitly allowed may interact with the bot.
 *
 * Authorization Flow:
 * 1. On startup, ALLOWED_USER_IDS is read from environment (comma-separated numbers)
 * 2. For each incoming update, the middleware extracts the user's Telegram ID
 * 3. If the ID is in the whitelist, the request proceeds to the next handler
 * 4. If not, a friendly "not authorized" message is sent and the request chain terminates
 *
 * Environment Variable:
 *   ALLOWED_USER_IDS="123456789,987654321"
 *
 * Security Considerations:
 * - Telegram user IDs are stable numeric identifiers that rarely change
 * - This is a simple authorization mechanism suitable for personal bots
 * - For production use with many users, consider a more robust permission system
 */

/**
 * Parses the ALLOWED_USER_IDS environment variable into a Set of numbers.
 * Returns an empty Set if the variable is not set or is malformed.
 */
function parseAllowedUserIds(): Set<number> {
  const envVar = process.env.ALLOWED_USER_IDS;

  if (!envVar) {
    console.warn("[auth] ALLOWED_USER_IDS not set - no users will be authorized");
    return new Set<number>();
  }

  try {
    const ids = envVar
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const num = Number.parseInt(s, 10);
        if (Number.isNaN(num)) {
          throw new Error(`Invalid user ID: "${s}"`);
        }
        return num;
      });

    return new Set(ids);
  } catch (error) {
    console.error("[auth] Failed to parse ALLOWED_USER_IDS:", error);
    return new Set<number>();
  }
}

/**
 * Cached Set of allowed Telegram user IDs.
 * Initialized once at startup to avoid repeated parsing.
 */
const ALLOWED_IDS = parseAllowedUserIds();

/**
 * Checks whether a user is authorized to use the bot.
 *
 * @param ctx - The Grammy Context object containing the incoming update
 * @returns true if the user's ID is in the whitelist, false otherwise
 *
 * @example
 * ```ts
 * if (isAuthenticated(ctx)) {
 *   // User is allowed
 * }
 * ```
 */
export function isAuthenticated(ctx: Context): boolean {
  const from = ctx.from;

  // In some update types (e.g., channel posts), there may be no "from" user
  if (!from) {
    return false;
  }

  return ALLOWED_IDS.has(from.id);
}

/**
 * Grammy middleware that enforces authentication.
 * Unauthorized users receive a friendly message and the middleware chain terminates.
 *
 * @param ctx - The Grammy Context object
 * @param next - The next middleware function in the chain
 *
 * @example
 * ```ts
 * bot.use(requireAuth);
 * // All handlers below this line are protected
 * ```
 */
export async function requireAuth(
  ctx: Context,
  next: () => Promise<void>,
): Promise<void> {
  if (isAuthenticated(ctx)) {
    // User is authorized, proceed to next handler
    await next();
    return;
  }

  // User is not authorized
  const username = ctx.from?.username ?? ctx.from?.first_name ?? "Unknown user";

  await ctx.reply(
    `Sorry, you're not authorized to use this bot.\n` +
      `Your user ID: \`${ctx.from?.id ?? "unknown"}\`\n` +
      `Please contact the bot owner if you believe this is an error.`,
    { parse_mode: "Markdown" },
  );
}

/**
 * Returns the list of authorized user IDs for debugging/admin purposes.
 *
 * @returns A sorted array of allowed user IDs
 */
export function getAllowedUserIds(): number[] {
  return Array.from(ALLOWED_IDS).sort((a, b) => a - b);
}

/**
 * Checks if the whitelist is empty (indicating a configuration issue).
 *
 * @returns true if no users are authorized
 */
export function isWhitelistEmpty(): boolean {
  return ALLOWED_IDS.size === 0;
}
