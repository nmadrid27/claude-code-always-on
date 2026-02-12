// src/relay.ts
// Claude Code Relay Wrapper
//
// Invokes Claude Code CLI in headless mode and processes the output.
// Supports streaming responses, timeout handling, and formatted output for Telegram.

/**
 * ============================================================================
 * TYPES & INTERFACES
 * ============================================================================
 */

/**
 * Tool call made by Claude Code during execution
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

/**
 * Request options for invoking Claude Code
 */
export interface ClaudeCodeRequest {
  /** The prompt/question to send to Claude Code */
  prompt: string;

  /** List of tools Claude is allowed to use (e.g., ["bash", "read", "write"]) */
  allowedTools?: string[];

  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;

  /** Enable streaming output for long-running operations (default: false) */
  stream?: boolean;

  /** Optional working directory for the command execution */
  workingDirectory?: string;

  /** Maximum output length in characters (for Telegram limits) */
  maxOutputLength?: number;
}

/**
 * Response from Claude Code invocation
 */
export interface ClaudeCodeResponse {
  /** Whether the invocation succeeded */
  success: boolean;

  /** The main output text from Claude */
  output?: string;

  /** Error message if invocation failed */
  error?: string;

  /** Tool calls made during execution (if available) */
  toolCalls?: ToolCall[];

  /** Metadata about the invocation */
  metadata?: {
    /** Approximate tokens used (if available in output) */
    tokensUsed?: number;
    /** Execution duration in milliseconds */
    duration: number;
    /** Whether the output was truncated */
    truncated: boolean;
    /** Exit code from Claude Code process */
    exitCode: number | null;
  };
}

/**
 * Stream callback for receiving incremental updates
 */
export type StreamCallback = (chunk: string, isFinal: boolean) => void | Promise<void>;

/**
 * ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

/** Default timeout for Claude Code invocation (5 minutes) */
const DEFAULT_TIMEOUT_MS = 300000;

/** Default maximum output length (Telegram message limit is 4096, leave room for formatting) */
const DEFAULT_MAX_OUTPUT_LENGTH = 3500;

/** Claude Code executable name */
const CLAUDE_COMMAND = "claude";

/**
 * ============================================================================
 * LOGGING
 * ============================================================================
 */

import { createLogger } from "./services/logger.js";

const log = createLogger("relay");

function logDebug(message: string, ...args: unknown[]): void {
  log.debug(message, args.length ? { extra: args } : undefined);
}

function logError(message: string, ...args: unknown[]): void {
  log.error(message, args.length ? { extra: args } : undefined);
}

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

/**
 * Truncates text to fit within a maximum length, preserving markdown formatting
 * Adds a truncation indicator if text was cut off
 */
function truncateOutput(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }

  // Try to truncate at a sentence boundary
  const truncated = text.substring(0, maxLength - 20); // Leave room for ellipsis

  // Find the last sentence-ending punctuation
  const lastPeriod = truncated.lastIndexOf(". ");
  const lastNewline = truncated.lastIndexOf("\n");
  const cutoff = Math.max(lastPeriod, lastNewline);

  if (cutoff > maxLength * 0.5) {
    // We found a good cutting point
    return {
      text: truncated.substring(0, cutoff + 1) + "\n\n_... (output truncated)_",
      truncated: true
    };
  }

  // No good cutting point, just hard truncate
  return {
    text: truncated + "\n\n_... (output truncated)_",
    truncated: true
  };
}

/**
 * Formats output for Telegram display
 * Uses code blocks for code, preserves basic formatting
 */
function formatForTelegram(output: string): string {
  // Check if output contains code blocks
  if (output.includes("```")) {
    // Output already has code block formatting, preserve as-is
    return output;
  }

  // Check if output looks like code (contains common code patterns)
  const codePatterns = [
    /^(function|const|let|var|class|import|export|from)\s/m,
    /^[a-z_][a-z0-9_]*\s*\(/m,  // Function calls
    /^\s*[a-z_][a-z0-9_]*:\s*/m  // Object properties
  ];

  const isCode = codePatterns.some(pattern => pattern.test(output));

  if (isCode) {
    // Wrap in code block
    return `\`\`\`\n${output}\n\`\`\``;
  }

  return output;
}

/**
 * Builds the command arguments array for invoking Claude Code
 */
function buildCommandArgs(request: ClaudeCodeRequest): string[] {
  const args: string[] = [];

  // Main prompt flag
  args.push("-p", request.prompt);

  // JSON output format
  args.push("--output-format", "json");

  // Allowed tools (if specified)
  if (request.allowedTools && request.allowedTools.length > 0) {
    args.push("--allowedTools", request.allowedTools.join(","));
  }

  // Note: Timeout is handled by our wrapper, not passed to Claude
  // This is because we need to kill the process if it exceeds the timeout

  return args;
}

/**
 * ============================================================================
 * MAIN INVOCATION FUNCTION
 * ============================================================================
 */

/**
 * Invokes Claude Code CLI in headless mode and returns the response
 *
 * @param request - The request parameters for Claude Code
 * @param streamCallback - Optional callback for streaming updates
 * @returns Promise resolving to ClaudeCodeResponse
 *
 * @example
 * ```typescript
 * const response = await invokeClaudeCode({
 *   prompt: "List all files in the current directory",
 *   allowedTools: ["bash"],
 *   timeout: 60000
 * });
 *
 * if (response.success) {
 *   console.log(response.output);
 * } else {
 *   console.error(response.error);
 * }
 * ```
 */
export async function invokeClaudeCode(
  request: ClaudeCodeRequest,
  streamCallback?: StreamCallback
): Promise<ClaudeCodeResponse> {
  const startTime = Date.now();
  const timeout = request.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxOutputLength = request.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH;

  logDebug(`Invoking Claude Code with prompt: "${request.prompt.substring(0, 50)}..."`);

  // Validate input
  if (!request.prompt || request.prompt.trim().length === 0) {
    return {
      success: false,
      error: "Prompt cannot be empty",
      metadata: {
        duration: Date.now() - startTime,
        truncated: false,
        exitCode: null
      }
    };
  }

  // Build command arguments
  const args = buildCommandArgs(request);

  // Prepare command array: [command, ...args]
  const cmdArray = [CLAUDE_COMMAND, ...args];

  // Prepare environment variables
  const env = process.env.ANTHROPIC_API_KEY
    ? { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
    : undefined;

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let outputBuffer = "";
  let errorBuffer = "";

  try {
    // Spawn the Claude Code process
    proc = Bun.spawn(cmdArray, {
      cwd: request.workingDirectory || process.cwd(),
      env,
      stdout: "pipe",
      stderr: "pipe"
    });

    // Set up timeout handler
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        logError(`Claude Code invocation timed out after ${timeout}ms`);
        if (proc) {
          proc.kill();
        }
        reject(new Error(`Claude Code invocation timed out after ${timeout}ms`));
      }, timeout);
    });

    // Set up output collection
    const outputPromise = (async () => {
      if (!proc) {
        throw new Error("Process failed to spawn");
      }

      const stdout = proc.stdout;
      if (!stdout || typeof stdout === "number") {
        throw new Error("stdout is not piped");
      }

      // Read stdout and stderr in parallel to avoid deadlock
      const readStdout = async () => {
        const decoder = new TextDecoder();
        const reader = stdout.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          outputBuffer += chunk;
          if (streamCallback) {
            await streamCallback(chunk, false);
          }
        }
      };

      const readStderr = async () => {
        const stderr = proc!.stderr;
        if (stderr && typeof stderr !== "number") {
          const errorReader = stderr.getReader();
          while (true) {
            const { done, value } = await errorReader.read();
            if (done) break;
            errorBuffer += new TextDecoder().decode(value);
          }
        }
      };

      await Promise.all([readStdout(), readStderr()]);

      // Wait for process to exit
      const exitCode = await proc.exited;

      return { exitCode, output: outputBuffer, error: errorBuffer };
    })();

    // Wait for either output completion or timeout
    const result = await Promise.race([outputPromise, timeoutPromise]);

    // Clear timeout
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    const duration = Date.now() - startTime;

    // Check exit code
    if (result.exitCode !== 0) {
      logError(`Claude Code exited with code ${result.exitCode}`);
      logError(`stderr: ${result.error}`);

      return {
        success: false,
        error: `Claude Code exited with code ${result.exitCode}${result.error ? `: ${result.error}` : ""}`,
        metadata: {
          duration,
          truncated: false,
          exitCode: result.exitCode
        }
      };
    }

    // Parse JSON output
    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(result.output);
    } catch (parseError) {
      logError(`Failed to parse Claude Code JSON output: ${parseError}`);
      logError(`Raw output: ${result.output.substring(0, 500)}`);

      // Output might not be JSON yet, return as-is
      const { text, truncated } = truncateOutput(result.output, maxOutputLength);

      return {
        success: true,
        output: formatForTelegram(text),
        metadata: {
          duration,
          truncated,
          exitCode: result.exitCode
        }
      };
    }

    // Extract response from parsed JSON
    // Claude Code JSON output structure may vary, handle common formats
    let outputText = "";
    let toolCalls: ToolCall[] | undefined;
    let tokensUsed: number | undefined;

    if (typeof parsedOutput === "string") {
      outputText = parsedOutput;
    } else if (parsedOutput && typeof parsedOutput === "object") {
      const obj = parsedOutput as Record<string, unknown>;

      // Try various possible response fields
      // Claude Code CLI returns: { type: "result", result: "...", usage: {...} }
      outputText = (obj.result ?? obj.output ?? obj.response ?? obj.text ?? obj.message ?? obj.content ?? "") as string;

      // Extract tool calls if present
      if (Array.isArray(obj.toolCalls)) {
        toolCalls = obj.toolCalls as ToolCall[];
      }

      // Extract token usage if present
      if (typeof obj.tokensUsed === "number") {
        tokensUsed = obj.tokensUsed;
      } else if (typeof obj.usage === "object" && obj.usage) {
        const usage = obj.usage as Record<string, unknown>;
        if (typeof usage.total_tokens === "number") {
          tokensUsed = usage.total_tokens;
        }
      }
    }

    // Handle empty output
    if (!outputText && result.output) {
      outputText = result.output;
    }

    // Format and truncate output for Telegram
    const { text, truncated } = truncateOutput(
      typeof outputText === "string" ? outputText : JSON.stringify(outputText),
      maxOutputLength
    );

    const formattedOutput = formatForTelegram(text);

    // Send final streaming update
    if (streamCallback) {
      await streamCallback("", true);
    }

    logDebug(`Claude Code invocation completed in ${duration}ms${truncated ? " (output truncated)" : ""}`);

    return {
      success: true,
      output: formattedOutput,
      toolCalls,
      metadata: {
        tokensUsed,
        duration,
        truncated,
        exitCode: result.exitCode
      }
    };

  } catch (error) {
    // Clear timeout if still active
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logError(`Claude Code invocation failed: ${errorMessage}`);

    return {
      success: false,
      error: errorMessage,
      metadata: {
        duration,
        truncated: false,
        exitCode: proc ? await proc.exited.catch(() => null) : null
      }
    };
  }
}

/**
 * ============================================================================
 * CONVENIENCE FUNCTIONS
 * ============================================================================
 */

/**
 * Simple invocation with most common defaults
 */
export async function askClaude(prompt: string, workingDirectory?: string): Promise<string> {
  const response = await invokeClaudeCode({
    prompt,
    workingDirectory,
    timeout: 60000, // 1 minute default
    maxOutputLength: DEFAULT_MAX_OUTPUT_LENGTH
  });

  if (!response.success) {
    throw new Error(response.error || "Claude Code invocation failed");
  }

  return response.output || "";
}

/**
 * Invoke Claude Code with specific tools allowed
 */
export async function askClaudeWithTools(
  prompt: string,
  tools: string[],
  workingDirectory?: string
): Promise<ClaudeCodeResponse> {
  return invokeClaudeCode({
    prompt,
    allowedTools: tools,
    workingDirectory,
    timeout: 300000 // 5 minutes for tool-using tasks
  });
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

export default {
  invokeClaudeCode,
  askClaude,
  askClaudeWithTools
};
