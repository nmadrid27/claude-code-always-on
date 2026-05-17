// src/middleware/security.ts
/**
 * Security Module for Claude Code Always-On
 *
 * This module implements:
 * - Input validation and sanitization
 * - Claude Code permission-gated execution
 * - Command restrictions and safety checks
 * - Rate limiting considerations
 */

/**
 * Maximum allowed lengths for various inputs to prevent DoS attacks
 */
export const INPUT_LIMITS = {
  MAX_TEXT_LENGTH: 4000, // Telegram's max message length
  MAX_CAPTION_LENGTH: 1024,
  MAX_COMMAND_LENGTH: 100,
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024, // 50MB
  MAX_CONCURRENT_REQUESTS: 10,
} as const;

/**
 * Dangerous patterns that should never be executed without explicit review
 */
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+[\/~]/, // rm -rf with absolute path
  /\bdd\s+if=/, // dd command (disk destruction)
  /\bmkfs\./, // Filesystem creation
  /\bchmod\s+000/, // Removing all permissions
  /\bshutdown\b/, // System shutdown
  /\breboot\b/, // System reboot
  />\s*\/\s*(dev|proc|sys)\//, // Redirecting to system directories
  /curl.*\|\s*(sh|bash)/, // Pipe curl to shell
  /wget.*\|\s*(sh|bash)/, // Pipe wget to shell
  /eval.*\$\(.*curl/, // Eval with curl command substitution
  /eval.*\$\(.*wget/, // Eval with wget command substitution
] as const;

/**
 * File extensions that are potentially dangerous
 */
const DANGEROUS_FILE_EXTENSIONS = [
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".exe",
  ".bat",
  ".cmd",
  ".scr",
  ".dll",
  ".so",
  ".dylib",
] as const;

/**
 * Validates a string input against common attacks
 *
 * @param input - The string to validate
 * @param maxLength - Maximum allowed length
 * @returns Object with isValid flag and error message if invalid
 */
export function validateStringInput(
  input: string,
  maxLength: number = INPUT_LIMITS.MAX_TEXT_LENGTH
): { isValid: boolean; error?: string } {
  // Check if input exists
  if (input === null || input === undefined) {
    return { isValid: false, error: "Input is null or undefined" };
  }

  // Check type
  if (typeof input !== "string") {
    return { isValid: false, error: "Input is not a string" };
  }

  // Check length
  if (input.length > maxLength) {
    return {
      isValid: false,
      error: `Input exceeds maximum length of ${maxLength} characters`,
    };
  }

  // Check for empty input
  if (input.trim().length === 0) {
    return { isValid: false, error: "Input is empty" };
  }

  return { isValid: true };
}

/**
 * Checks if a command contains dangerous patterns
 *
 * @param command - The command string to check
 * @returns Object with isSafe flag and reason if unsafe
 */
export function checkCommandSafety(
  command: string
): { isSafe: boolean; reason?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        isSafe: false,
        reason: `Command matches dangerous pattern: ${pattern.source}`,
      };
    }
  }

  // Check for suspicious shell variable access
  if (/\${[^}]*}[;\|&`]/.test(command)) {
    return {
      isSafe: false,
      reason: "Command contains potentially unsafe variable expansion",
    };
  }

  return { isSafe: true };
}

/**
 * Sanitizes a filename to prevent directory traversal and other attacks
 *
 * @param filename - The filename to sanitize
 * @returns Sanitized filename or empty string if invalid
 */
export function sanitizeFilename(filename: string): string {
  // Remove path components
  let sanitized = filename.replace(/.*[\/\\]/, "");

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, "");

  // Limit length
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }

  // Remove dangerous characters (keep basic filename-safe chars)
  sanitized = sanitized.replace(/[<>:"|?*\x00-\x1f]/g, "_");

  return sanitized;
}

/**
 * Checks if a file extension is potentially dangerous
 *
 * @param filename - The filename to check
 * @returns true if the file extension is considered dangerous
 */
export function isDangerousFileExtension(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return DANGEROUS_FILE_EXTENSIONS.some((dangerous) => ext === dangerous);
}

/**
 * Validates a Telegram user ID
 *
 * @param userId - The user ID to validate
 * @returns true if valid
 */
export function isValidUserId(userId: number): boolean {
  // Telegram user IDs are positive integers, typically 7-10 digits
  return (
    Number.isInteger(userId) &&
    userId > 0 &&
    userId < 10_000_000_000 &&
    userId.toString().length >= 7
  );
}

/**
 * Rate limit tracker for preventing abuse
 */
export class RateLimiter {
  private requests: Map<number, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 10, windowMs: number = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if a user has exceeded their rate limit
   *
   * @param userId - The user's Telegram ID
   * @returns true if the request should be allowed
   */
  checkLimit(userId: number): boolean {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];

    // Filter out requests outside the time window
    const validRequests = userRequests.filter(
      (time) => now - time < this.windowMs
    );

    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    // Add current request
    validRequests.push(now);
    this.requests.set(userId, validRequests);

    return true;
  }

  /**
   * Get remaining requests for a user
   *
   * @param userId - The user's Telegram ID
   * @returns Number of remaining requests
   */
  getRemaining(userId: number): number {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];
    const validRequests = userRequests.filter(
      (time) => now - time < this.windowMs
    );
    return Math.max(0, this.maxRequests - validRequests.length);
  }

  /**
   * Clear rate limit data for a user
   *
   * @param userId - The user's Telegram ID
   */
  clearUser(userId: number): void {
    this.requests.delete(userId);
  }
}

/**
 * Permission levels for Claude Code execution
 */
export enum PermissionLevel {
  /**
   * Read-only: Can view files but not execute commands
   */
  READ_ONLY = "read_only",

  /**
   * Safe: Can execute safe commands (no file writes, no network)
   */
  SAFE = "safe",

  /**
   * Standard: Can execute most commands with confirmation
   */
  STANDARD = "standard",

  /**
   * Full: Can execute any command (use with extreme caution)
   */
  FULL = "full",
}

/**
 * Default allowed tools for each permission level
 */
export const PERMISSION_TOOLS: Record<
  PermissionLevel,
  readonly string[]
> = {
  [PermissionLevel.READ_ONLY]: ["read"],
  [PermissionLevel.SAFE]: ["read", "web-search", "grep"],
  [PermissionLevel.STANDARD]: ["read", "write", "bash", "web-search", "grep"],
  [PermissionLevel.FULL]: ["*"], // All tools
} as const;

/**
 * Configuration for Claude Code execution with permissions
 */
export interface ClaudeCodeConfig {
  /** Permission level for this execution */
  permissionLevel: PermissionLevel;
  /** Whether to require user confirmation before executing */
  requireConfirmation: boolean;
  /** Maximum execution time in milliseconds */
  timeout: number;
  /** Additional tools to allow beyond permission level */
  additionalTools?: string[];
}

/**
 * Creates a safe Claude Code execution configuration
 *
 * @param config - Partial config with defaults applied
 * @returns Complete configuration object
 */
export function createSafeConfig(
  config: Partial<ClaudeCodeConfig> = {}
): ClaudeCodeConfig {
  return {
    permissionLevel: config.permissionLevel ?? PermissionLevel.STANDARD,
    requireConfirmation: config.requireConfirmation ?? true,
    timeout: config.timeout ?? 300_000, // 5 minutes
    additionalTools: config.additionalTools ?? [],
  };
}

/**
 * Validates that environment variables are properly configured
 *
 * @returns Object with isValid flag and missing variables
 */
export function validateEnvironment(): {
  isValid: boolean;
  missing: string[];
  warnings: string[];
} {
  const required = [
    "TELEGRAM_BOT_TOKEN",
    "ALLOWED_USER_IDS",
    "CLAUDE_TIMEOUT",
  ] as const;

  const optional = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VOYAGE_API_KEY",
    "ELEVENLABS_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
  ] as const;

  const missing: string[] = [];
  const warnings: string[] = [];

  for (const envVar of required) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  // Validate formats
  if (process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.match(/^\d+:[A-Za-z0-9_-]+$/)) {
    warnings.push("TELEGRAM_BOT_TOKEN format appears invalid");
  }

  if (process.env.ALLOWED_USER_IDS) {
    const ids = process.env.ALLOWED_USER_IDS.split(",").map((s) => s.trim());
    for (const id of ids) {
      const num = Number.parseInt(id, 10);
      if (!isValidUserId(num)) {
        warnings.push(`Invalid user ID in ALLOWED_USER_IDS: ${id}`);
      }
    }
  }

  if (process.env.CLAUDE_TIMEOUT) {
    const timeout = Number.parseInt(process.env.CLAUDE_TIMEOUT, 10);
    if (timeout < 1000 || timeout > 600_000) {
      warnings.push("CLAUDE_TIMEOUT should be between 1000 and 600000 ms");
    }
  }

  return {
    isValid: missing.length === 0,
    missing,
    warnings,
  };
}
