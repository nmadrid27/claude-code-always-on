// src/bot.ts
// Main Telegram bot implementation using Grammy

import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { basename, resolve } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, writeSync, closeSync, constants } from "fs";
import { requireAuth } from "./middleware/auth.js";
import { parseMessage, MessageType } from "./middleware/parser.js";
import { invokeClaudeCode } from "./relay.js";
import { getGoalService } from "./services/goals.js";
import { createLogger } from "./services/logger.js";
import {
  recordCost,
  estimateCost,
  formatCostsMessage,
  incrementErrors,
} from "./services/cost-tracker.js";
import {
  RateLimiter,
  validateStringInput,
  sanitizeFilename,
  INPUT_LIMITS,
  checkCommandSafety,
} from "./middleware/security.js";
import {
  buildContext,
  storeUserMessage,
  storeAssistantMessage,
} from "./services/context-builder.js";
import { handleNLPCommand } from "./services/nlp-commands.js";
import {
  isVaultAvailable,
  readVaultFile,
  getVaultStatus,
  createTelegramResponse,
  addVaultTask,
  createVaultIdea,
  searchVault,
} from "./services/vault-bridge.js";
import {
  searchVaultFilesystem,
  formatVaultFsHits,
} from "./services/vault-fs.js";

const log = createLogger("bot");

// Rate limiter: 10 requests per 60 seconds per user
const rateLimiter = new RateLimiter(10, 60_000);

// Bash permission state machine: tracks per-user bash unlock flow
type BashState = "bash_pending" | "bash_ready";
const bashStateMap = new Map<number, BashState>();

// Initialize bot with token from environment
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  const earlyLog = createLogger("bot");
  earlyLog.error("TELEGRAM_BOT_TOKEN environment variable is not set");
  process.exit(1);
}

export const bot = new Bot(token);

// Apply authentication middleware to all handlers
bot.use(requireAuth);

// Log when bot starts
bot.api.config.use((prev, method, payload) => {
  log.debug("API call", { method });
  return prev(method, payload);
});

// ============================================================================
// Command Handlers
// ============================================================================

// /start command - Welcome message
bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 *Welcome to Claude Code Always-On!*\n\n" +
    "I'm your personal AI assistant powered by Claude Code.\n\n" +
    "*Commands:*\n" +
    "/start - Show this welcome message\n" +
    "/help - Show available commands\n" +
    "/status - Check bot status\n\n" +
    "Just send me a message and I'll help you out!",
    { parse_mode: "Markdown" }
  );
});

// /help command - Show available commands
bot.command("help", async (ctx) => {
  await ctx.reply(
    "📖 *Help*\n\n" +
    "*Available Commands:*\n" +
    "/start - Welcome message\n" +
    "/help - Show this help\n" +
    "/status - Bot status\n" +
    "/goals - List your active goals\n" +
    "/costs - View usage and cost stats\n" +
    "/bash - Request bash + write access for next message\n" +
    "/confirm - Confirm a pending bash request\n" +
    "/vault - Interact with Obsidian vault (read, write, tasks)\n" +
    "/away - Enable remote mode (Telegram notifications on)\n" +
    "/home - Disable remote mode (notifications off)\n\n" +
    "*Supported Message Types:*\n" +
    "• 📝 Text - Send any question or command\n" +
    "• 📷 Photos - Send images for analysis\n" +
    "• 🎤 Voice notes - Send voice messages\n" +
    "• 📄 Documents - Upload files\n" +
    "• 🎥 Videos - Send video files\n\n" +
    "*Features:*\n" +
    "• Ask me to run commands\n" +
    "• Request code analysis\n" +
    "• Get explanations\n" +
    "• File operations\n\n" +
    "_I'll respond as soon as I can!_",
    { parse_mode: "Markdown" }
  );
});

// /status command - Check bot status
bot.command("status", async (ctx) => {
  const uptime = process.uptime();
  const uptimeStr = formatUptime(uptime);

  await ctx.reply(
    "🟢 *Bot Status*\n\n" +
    `*Status:* Online\n` +
    `*Uptime:* ${uptimeStr}\n` +
    `*User:* @${ctx.from?.username || "N/A"}\n` +
    `*User ID:* \`${ctx.from?.id}\`\n\n` +
    "_All systems operational_",
    { parse_mode: "Markdown" }
  );
});

// /goals command - List active goals
bot.command("goals", async (ctx) => {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply("Could not identify your user ID.");
    return;
  }

  try {
    const goalService = getGoalService();
    const activeGoals = await goalService.getActiveGoals(userId);
    const formatted = goalService.formatGoalsList(activeGoals);

    try {
      await ctx.reply(formatted, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(formatted);
    }
  } catch (error) {
    log.error("Error fetching goals", { error: String(error) });
    await ctx.reply("Sorry, I had trouble fetching your goals.");
  }
});

// /costs command - Show usage and cost stats
bot.command("costs", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("Could not identify your user ID.");
    return;
  }

  const message = formatCostsMessage(userId);
  try {
    await ctx.reply(message, { parse_mode: "Markdown" });
  } catch {
    await ctx.reply(message);
  }
});

// /bash command - Request bash + write access for next message
bot.command("bash", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  try {
    bashStateMap.set(userId, "bash_pending");
    await ctx.reply(
      "🔓 *Bash access requested.*\n\nSend /confirm to enable bash + write tools for your next message, or send any other message to cancel.",
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    log.error("Error in /bash handler", { error: String(error) });
  }
});

// /confirm command - Confirm pending bash access request
bot.command("confirm", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  try {
    if (bashStateMap.get(userId) === "bash_pending") {
      bashStateMap.set(userId, "bash_ready");
      await ctx.reply(
        "✅ *Bash + write access enabled for your next message.*\n\nSend your command now.",
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply("No pending bash request. Send /bash first.");
    }
  } catch (error) {
    log.error("Error in /confirm handler", { error: String(error) });
  }
});

// /vault command - Interact with Obsidian vault
bot.command("vault", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Rate limit vault commands (same limiter as text messages)
  if (!rateLimiter.checkLimit(userId)) {
    await ctx.reply("You're sending commands too fast. Please wait a moment.");
    return;
  }

  try {
    const rawText = ctx.message?.text || "";
    // Strip "/vault" prefix and get subcommand + args
    const afterCommand = rawText.replace(/^\/vault\s*/, "").trim();

    if (!afterCommand) {
      await ctx.reply(
        "*Vault Commands*\n\n" +
        "`/vault status` - Check vault & task status\n" +
        "`/vault read <path>` - Read a vault file\n" +
        "`/vault respond <text>` - Save response for pending question\n" +
        "`/vault task <description>` - Add task to TASKS.md\n" +
        "`/vault idea <content>` - Create idea in vault\n" +
        "`/vault search <query>` - Search vault content\n",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const spaceIdx = afterCommand.indexOf(" ");
    const subcommand = spaceIdx === -1 ? afterCommand : afterCommand.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? "" : afterCommand.slice(spaceIdx + 1).trim();

    switch (subcommand.toLowerCase()) {
      case "status": {
        const thinkingMsg = await ctx.reply("Checking vault status...");
        const status = await getVaultStatus();
        await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);
        try {
          await ctx.reply(`*Vault Status*\n\n${status}`, { parse_mode: "Markdown" });
        } catch {
          await ctx.reply(`Vault Status\n\n${status}`);
        }
        break;
      }

      case "read": {
        if (!args || args.length > 500) {
          await ctx.reply("Usage: `/vault read <file-path>` (max 500 chars)\n\nExample: `/vault read context/TASKS.md`", { parse_mode: "Markdown" });
          return;
        }
        const thinkingMsg = await ctx.reply("Reading vault file...");
        const content = await readVaultFile(args);
        await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);
        // Truncate for Telegram's 4096 char limit
        const truncated = content.length > 3500
          ? content.slice(0, 3500) + "\n\n... (truncated)"
          : content;
        await ctx.reply(truncated);
        break;
      }

      case "respond": {
        if (!args) {
          await ctx.reply("Usage: `/vault respond <your response text>`", { parse_mode: "Markdown" });
          return;
        }
        if (args.length > 5000) {
          await ctx.reply("Response too long (max 5000 characters).");
          return;
        }
        const fileName = await createTelegramResponse(args);
        await ctx.reply(`Response saved to vault:\n\`${fileName}\`\n\nThis will be available when you return to Obsidian.`, { parse_mode: "Markdown" });
        break;
      }

      case "task": {
        if (!args) {
          await ctx.reply("Usage: `/vault task <task description>`", { parse_mode: "Markdown" });
          return;
        }
        if (args.length > 500) {
          await ctx.reply("Task description too long (max 500 characters).");
          return;
        }
        await addVaultTask(args);
        await ctx.reply(`Task added to TASKS.md:\n\n- [ ] ${args}`);
        break;
      }

      case "idea": {
        if (!args) {
          await ctx.reply("Usage: `/vault idea <your idea>`", { parse_mode: "Markdown" });
          return;
        }
        if (args.length > 2000) {
          await ctx.reply("Idea too long (max 2000 characters).");
          return;
        }
        const ideaFile = await createVaultIdea(args);
        await ctx.reply(`Idea saved to vault:\n\`${ideaFile}\``, { parse_mode: "Markdown" });
        break;
      }

      case "search": {
        if (!args) {
          await ctx.reply("Usage: `/vault search <query>`", { parse_mode: "Markdown" });
          return;
        }
        const thinkingMsg = await ctx.reply("Searching vault...");

        // Primary: Obsidian Local REST API (richer index when the app is open).
        // Fallback: read-only filesystem grep of the synced vault on disk, which
        // works even when Obsidian is closed and never touches the REST/MCP.
        try {
          const results = await searchVault(args);
          await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);
          if (results.length === 0) {
            await ctx.reply("No results found.");
          } else {
            const formatted = results.map((f, i) => `${i + 1}. \`${f}\``).join("\n");
            try {
              await ctx.reply(`*Search results for "${args}":*\n\n${formatted}`, { parse_mode: "Markdown" });
            } catch {
              await ctx.reply(`Search results for "${args}":\n\n${formatted}`);
            }
          }
        } catch (restErr) {
          log.warn("Vault REST search unavailable; using filesystem fallback", {
            error: String(restErr),
          });
          const fsHits = await searchVaultFilesystem(args);
          await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);
          // Plain text (no Markdown) so snippet characters cannot break parsing.
          await ctx.reply(formatVaultFsHits(fsHits, args));
        }
        break;
      }

      default:
        await ctx.reply(`Unknown vault command: \`${subcommand}\`\n\nSend /vault for available commands.`, { parse_mode: "Markdown" });
    }
  } catch (error) {
    log.error("Error in /vault handler", {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Generic message to user; full details in server logs only
    const isValidation = error instanceof Error && error.message.includes("validation failed");
    const userMsg = isValidation
      ? `Vault error: ${error.message}`
      : "Vault operation failed. Check server logs for details.";
    await ctx.reply(userMsg);
  }
});

// /away command - Enable remote mode
bot.command("away", async (ctx) => {
  const flagPath = resolve(process.env.HOME || "", ".claude/remote-mode");
  try {
    writeFileSync(flagPath, new Date().toISOString(), { mode: 0o600 });
    await ctx.reply("Remote mode ON\n\nNotifications and permission prompts will be sent here.\nUse `claude-telegram` on your terminal for permission approval.", { parse_mode: "Markdown" });
  } catch (error) {
    log.error("Error in /away handler", { error: String(error) });
    await ctx.reply("Failed to enable remote mode.");
  }
});

// /home command - Disable remote mode
bot.command("home", async (ctx) => {
  const flagPath = resolve(process.env.HOME || "", ".claude/remote-mode");
  try {
    try { unlinkSync(flagPath); } catch {}
    await ctx.reply("Remote mode OFF\n\nNotifications silenced. Use normal `claude` command.");
  } catch (error) {
    log.error("Error in /home handler", { error: String(error) });
    await ctx.reply("Failed to disable remote mode.");
  }
});

// ============================================================================
// Permission Approval Callback Handler (for telegram-approver MCP server)
// ============================================================================

const APPROVALS_DIR = resolve(process.env.HOME || "/nonexistent", ".claude/approvals");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;

  // Only handle permission approval callbacks
  if (!data.startsWith("perm_")) return;

  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    let behavior: "allow" | "deny" = "deny";
    let requestId = "";
    let toolName: string | undefined;

    if (data.startsWith("perm_allow_tool:")) {
      // Format: perm_allow_tool:<requestId>:<toolName>
      const parts = data.slice("perm_allow_tool:".length).split(":");
      requestId = parts[0] || "";
      toolName = parts[1] || "";
      behavior = "allow";
    } else if (data.startsWith("perm_allow:")) {
      requestId = data.slice("perm_allow:".length);
      behavior = "allow";
    } else if (data.startsWith("perm_deny:")) {
      requestId = data.slice("perm_deny:".length);
      behavior = "deny";
    } else {
      return;
    }

    // H-1 fix: Validate requestId is a proper UUID to prevent path traversal
    if (!requestId || !UUID_RE.test(requestId)) {
      await ctx.answerCallbackQuery({ text: "Invalid request" });
      return;
    }

    // Verify the request file exists (prevents replaying old/fabricated callbacks)
    const requestPath = resolve(APPROVALS_DIR, `${requestId}.request.json`);
    if (!existsSync(requestPath)) {
      await ctx.answerCallbackQuery({ text: "Request expired or already handled" });
      return;
    }

    // M-1 fix: Read request file first and verify the callback sender is authorized
    let requestedTool = "unknown";
    try {
      const reqContent = readFileSync(requestPath, "utf-8");
      const reqData = JSON.parse(reqContent) as { tool_name?: string };
      requestedTool = reqData.tool_name || "unknown";
    } catch {
      await ctx.answerCallbackQuery({ text: "Could not read request" });
      return;
    }

    // M-2 fix: If "Allow All Similar" was used, verify toolName matches the original request
    if (toolName && toolName !== requestedTool) {
      log.warn("Tool name mismatch in callback", {
        expected: requestedTool,
        received: toolName,
        requestId: requestId.slice(0, 8),
      });
      toolName = requestedTool; // Use the original, not the callback-supplied value
    }

    // H-2 fix: Atomic write with O_EXCL prevents TOCTOU race (double-tap)
    const responsePath = resolve(APPROVALS_DIR, `${requestId}.response.json`);
    const responseData = {
      id: requestId,
      behavior,
      ...(toolName ? { tool_name: toolName } : {}),
      timestamp: new Date().toISOString(),
    };

    try {
      const fd = openSync(responsePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      writeSync(fd, JSON.stringify(responseData));
      closeSync(fd);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        await ctx.answerCallbackQuery({ text: "Already handled" });
        return;
      }
      throw err;
    }

    const label = behavior === "allow"
      ? (toolName ? `Allowed all ${requestedTool}` : "Allowed")
      : "Denied";

    await ctx.answerCallbackQuery({ text: label });

    // Remove inline keyboard and show decision in message text
    try {
      const originalText = ctx.callbackQuery.message?.text || "";
      await ctx.editMessageText(
        `${originalText}\n\nDecision: ${label}`,
        { reply_markup: { inline_keyboard: [] } },
      );
    } catch {
      // Message may be too old to edit; try just removing the keyboard
      try { await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }); } catch {}
    }

    log.info("Permission decision recorded", { requestId: requestId.slice(0, 8), behavior, toolName });
  } catch (error) {
    log.error("Error handling permission callback", { error: String(error) });
    await ctx.answerCallbackQuery({ text: "Error processing decision" });
  }
});

// ============================================================================
// Message Handlers
// ============================================================================

// TEXT messages
bot.on("message:text", async (ctx) => {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || ctx.from?.first_name || "unknown";
  const messageContent = ctx.message?.text || "";

  // Skip command messages — handled by dedicated bot.command() handlers above
  if (messageContent.startsWith("/")) return;

  // Rate limit check
  if (userId && !rateLimiter.checkLimit(userId)) {
    await ctx.reply("You're sending messages too fast. Please wait a moment.");
    return;
  }

  // Input validation
  const validation = validateStringInput(messageContent, INPUT_LIMITS.MAX_TEXT_LENGTH);
  if (!validation.isValid) {
    await ctx.reply(`Message rejected: ${validation.error}`);
    return;
  }

  try {
    const parsed = parseMessage(ctx);

    if (!parsed || parsed.type !== MessageType.TEXT) {
      return;
    }

    log.info("Text message received", { username, preview: parsed.content.substring(0, 50) });

    // Store the user message in Supabase (non-blocking)
    if (userId) {
      storeUserMessage(userId, parsed.content, ctx.message?.message_id).catch((err) => {
        log.warn("Failed to store user message", { error: String(err) });
      });
    }

    // Try NLP command handling first (instant response, no Claude Code call needed)
    if (userId) {
      try {
        const nlpResult = await handleNLPCommand(userId, parsed.content);
        if (nlpResult.handled && nlpResult.response) {
          try {
            await ctx.reply(nlpResult.response, { parse_mode: "Markdown" });
          } catch {
            await ctx.reply(nlpResult.response);
          }
          // Store the response in conversation history
          storeAssistantMessage(userId, nlpResult.response).catch(() => {});
          log.info("NLP command handled locally", { username });
          return;
        }
      } catch (err) {
        log.debug("NLP command check failed, falling through to Claude", { error: String(err) });
      }
    }

    // Cancel pending bash state if user sends regular text instead of /confirm.
    // Note: Grammy routes /confirm to bot.command("confirm") — it does NOT also
    // trigger this text handler for the same update. So this block only runs for
    // non-command text messages, which is the intended cancellation behavior.
    if (userId && bashStateMap.get(userId) === "bash_pending") {
      bashStateMap.delete(userId);
    }

    // Send "thinking" message to indicate processing
    const thinkingMsg = await ctx.reply("🤔 Thinking...");

    // Build rich prompt with conversation history, goals, facts, and semantic memory
    let prompt: string;
    let contextMeta = { conversationLength: 0, memoryHits: 0 };

    if (userId) {
      try {
        const context = await buildContext(userId, parsed.content);
        prompt = context.prompt;
        contextMeta = { conversationLength: context.conversationLength, memoryHits: context.memoryHits };
      } catch (err) {
        log.warn("Context build failed, using raw prompt", { error: String(err) });
        prompt = parsed.content;
      }
    } else {
      prompt = parsed.content;
    }

    // Determine tool permissions based on bash state
    // State is cleared BEFORE invocation (fail-safe: if invoke throws, permission is already gone)
    const bashReady = userId ? bashStateMap.get(userId) === "bash_ready" : false;
    if (userId && bashReady) {
      bashStateMap.delete(userId);
    }

    // Supplementary pattern check — only runs when user has explicitly requested bash access
    if (bashReady) {
      const safetyCheck = checkCommandSafety(messageContent);
      if (!safetyCheck.isSafe) {
        log.warn("Message blocked by safety check", { reason: safetyCheck.reason, username });
        await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);
        await ctx.reply(`⚠️ Message blocked: ${safetyCheck.reason}`);
        return;
      }
    }

    // Invoke Claude Code relay with rich context
    const response = await invokeClaudeCode({
      prompt,
      allowedTools: bashReady ? ["bash", "read", "write"] : ["read"],
      timeout: 120000,
      maxOutputLength: 3500,
      workingDirectory: process.cwd(),
    });

    // Delete the thinking message
    await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);

    if (response.success && response.output) {
      // Send Claude's response - try Markdown first, fall back to plain text
      try {
        await ctx.reply(response.output, { parse_mode: "Markdown" });
      } catch {
        await ctx.reply(response.output);
      }

      // Store assistant response in Supabase (non-blocking)
      if (userId) {
        storeAssistantMessage(userId, response.output).catch((err) => {
          log.warn("Failed to store assistant message", { error: String(err) });
        });
      }

      // Log metadata and record cost
      if (response.metadata) {
        const tokens = response.metadata.tokensUsed ?? 0;
        const cost = estimateCost(tokens);
        log.info("Response sent", {
          durationMs: response.metadata.duration,
          truncated: response.metadata.truncated,
          tokens,
          cost,
          contextMessages: contextMeta.conversationLength,
          memoryHits: contextMeta.memoryHits,
        });

        if (userId) {
          recordCost({
            userId,
            timestamp: Date.now(),
            cost,
            tokensUsed: tokens,
            durationMs: response.metadata.duration,
            operation: "text_message",
          });
        }
      }

      // Run goal detection in the background (don't block the response)
      if (userId) {
        detectAndTrackGoals(userId, messageContent).catch((err) => {
          log.error("Background goal detection error", { error: String(err) });
        });
      }
    } else {
      await ctx.reply(
        `❌ Error\n\n${response.error || "Unknown error occurred"}`
      );
      log.error("Claude Code error", { error: response.error });
      incrementErrors();
    }
  } catch (error) {
    log.error("Error handling text message", { error: String(error) });
    incrementErrors();
    await ctx.reply("❌ Sorry, I had trouble processing that message.");
  }
});

// PHOTO messages
bot.on("message:photo", async (ctx) => {
  try {
    const parsed = parseMessage(ctx);

    if (!parsed || parsed.type !== MessageType.PHOTO || !parsed.fileId) {
      return;
    }

    const username = ctx.from?.username || ctx.from?.first_name || "unknown";
    log.info("Photo received", { username, caption: parsed.content });

    const thinkingMsg = await ctx.reply("🔍 Analyzing image...");

    // Download the photo to /tmp
    const localPath = await downloadTelegramFile(parsed.fileId);

    // Build a prompt that references the downloaded image
    const captionContext = parsed.content
      ? `The user sent this photo with the caption: "${parsed.content}". `
      : "The user sent this photo without a caption. ";

    const prompt = `${captionContext}The image has been saved to tmp/${basename(localPath)}. Please analyze the image and describe what you see. If the user provided a caption, use it as context for your analysis.`;

    const response = await invokeClaudeCode({
      prompt,
      allowedTools: ["read"],
      timeout: 120000,
      maxOutputLength: 3500,
      workingDirectory: process.cwd(),
    });

    await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);

    if (response.success && response.output) {
      try {
        await ctx.reply(response.output, { parse_mode: "Markdown" });
      } catch {
        await ctx.reply(response.output);
      }
    } else {
      await ctx.reply(`❌ Could not analyze the image: ${response.error || "Unknown error"}`);
    }
  } catch (error) {
    log.error("Error handling photo message", { error: String(error) });
    incrementErrors();
    await ctx.reply("Sorry, I had trouble processing that photo.");
  }
});

// VOICE messages
bot.on("message:voice", async (ctx) => {
  try {
    const parsed = parseMessage(ctx);

    if (!parsed || parsed.type !== MessageType.VOICE || !parsed.fileId) {
      return;
    }

    const username = ctx.from?.username || ctx.from?.first_name || "unknown";
    const duration = parsed.metadata?.duration || 0;
    log.info("Voice note received", { username, duration });

    const thinkingMsg = await ctx.reply("🎤 Processing voice note...");

    // Download the .ogg voice file
    const localPath = await downloadTelegramFile(parsed.fileId, `voice_${Date.now()}.ogg`);

    await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);

    // Note: Full transcription requires Whisper API integration (not yet configured).
    // For now, acknowledge the download and provide file info.
    await ctx.reply(
      `🎤 *Voice note received and saved*\n\n` +
      `Duration: ${duration} seconds\n` +
      `File: \`${basename(localPath)}\`\n\n` +
      `_Transcription requires Whisper API integration (not yet configured). ` +
      `The audio file has been saved locally for future processing._`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    log.error("Error handling voice message", { error: String(error) });
    incrementErrors();
    await ctx.reply("Sorry, I had trouble processing that voice note.");
  }
});

// DOCUMENT messages
bot.on("message:document", async (ctx) => {
  try {
    const parsed = parseMessage(ctx);

    if (!parsed || parsed.type !== MessageType.DOCUMENT || !parsed.fileId) {
      return;
    }

    const username = ctx.from?.username || ctx.from?.first_name || "unknown";
    const fileName = parsed.metadata?.fileName || "unknown_file";
    log.info("Document received", { username, fileName });

    const thinkingMsg = await ctx.reply("📄 Processing document...");

    // Download the document
    const localPath = await downloadTelegramFile(parsed.fileId, fileName);

    // Try to read text content from the file
    const textContent = await readTextFile(localPath);

    let prompt: string;
    if (textContent) {
      // Text-based file: pass content directly to Claude Code
      const captionContext = parsed.content ? ` The user included this caption: "${parsed.content}".` : "";
      const truncatedContent = textContent.length > 10000
        ? textContent.substring(0, 10000) + "\n\n[... content truncated at 10,000 characters ...]"
        : textContent;

      prompt = `The user sent a document named "${fileName}" (${parsed.metadata?.mimeType || "unknown type"}).${captionContext}\n\nHere is the file content:\n\n${truncatedContent}\n\nPlease analyze this file and provide a helpful summary or response based on the content.`;
    } else {
      // Binary file: acknowledge and describe what we know
      const captionContext = parsed.content ? ` Caption: "${parsed.content}".` : "";
      prompt = `The user sent a binary document named "${fileName}" (${parsed.metadata?.mimeType || "unknown type"}, ${parsed.metadata?.fileSize ? formatBytes(parsed.metadata.fileSize) : "unknown size"}).${captionContext} The file has been saved to tmp/${basename(localPath)}. Since this is a binary file, please acknowledge receipt and describe what kind of file this is based on the name and MIME type. If it's a PDF, try reading it with available tools.`;
    }

    const response = await invokeClaudeCode({
      prompt,
      allowedTools: ["read"],
      timeout: 120000,
      maxOutputLength: 3500,
      workingDirectory: process.cwd(),
    });

    await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);

    if (response.success && response.output) {
      try {
        await ctx.reply(response.output, { parse_mode: "Markdown" });
      } catch {
        await ctx.reply(response.output);
      }
    } else {
      await ctx.reply(`❌ Could not analyze the document: ${response.error || "Unknown error"}`);
    }
  } catch (error) {
    log.error("Error handling document message", { error: String(error) });
    incrementErrors();
    await ctx.reply("Sorry, I had trouble processing that document.");
  }
});

// VIDEO messages
bot.on("message:video", async (ctx) => {
  try {
    const parsed = parseMessage(ctx);

    if (!parsed || parsed.type !== MessageType.VIDEO || !parsed.fileId) {
      return;
    }

    const username = ctx.from?.username || ctx.from?.first_name || "unknown";
    const duration = parsed.metadata?.duration || 0;
    log.info("Video received", { username, duration });

    const thinkingMsg = await ctx.reply("🎥 Processing video...");

    // Download the video
    const localPath = await downloadTelegramFile(parsed.fileId, `video_${Date.now()}.mp4`);

    // Build a prompt with video metadata for Claude Code
    const captionContext = parsed.content ? ` The user included this caption: "${parsed.content}".` : "";
    const dimensions = (parsed.metadata?.width && parsed.metadata?.height)
      ? `${parsed.metadata.width}x${parsed.metadata.height}`
      : "unknown";
    const fileSize = parsed.metadata?.fileSize ? formatBytes(parsed.metadata.fileSize) : "unknown";

    const prompt = `The user sent a video file.${captionContext}\n\nVideo details:\n- Duration: ${duration} seconds\n- Resolution: ${dimensions}\n- Size: ${fileSize}\n- MIME type: ${parsed.metadata?.mimeType || "video/mp4"}\n- Saved to: tmp/${basename(localPath)}\n\nPlease acknowledge the video, describe what you can determine from the metadata, and let the user know the file has been saved. If the user provided a caption, respond to it in context.`;

    const response = await invokeClaudeCode({
      prompt,
      allowedTools: ["read"],
      timeout: 120000,
      maxOutputLength: 3500,
      workingDirectory: process.cwd(),
    });

    await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);

    if (response.success && response.output) {
      try {
        await ctx.reply(response.output, { parse_mode: "Markdown" });
      } catch {
        await ctx.reply(response.output);
      }
    } else {
      await ctx.reply(`❌ Could not process the video: ${response.error || "Unknown error"}`);
    }
  } catch (error) {
    log.error("Error handling video message", { error: String(error) });
    incrementErrors();
    await ctx.reply("Sorry, I had trouble processing that video.");
  }
});

// ============================================================================
// File Download Helper
// ============================================================================

/**
 * Downloads a file from Telegram's servers and saves it to /tmp.
 * Uses ctx.api.getFile() to get the file path, then fetches from Telegram's file API.
 *
 * @param fileId - The Telegram file_id
 * @returns The local file path where the file was saved
 */
async function downloadTelegramFile(fileId: string, filename?: string): Promise<string> {
  const file = await bot.api.getFile(fileId);

  if (!file.file_path) {
    throw new Error("Telegram did not return a file path");
  }

  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const ext = file.file_path.split(".").pop() || "bin";
  const rawName = filename || `telegram_${fileId.substring(0, 12)}.${ext}`;
  const localName = sanitizeFilename(rawName);
  const tmpDir = new URL("../tmp", import.meta.url).pathname;
  try { await Bun.write(`${tmpDir}/.keep`, ""); } catch {}
  const localPath = `${tmpDir}/${localName}`;

  await Bun.write(localPath, buffer);
  log.info("Downloaded file", { path: localPath, bytes: buffer.byteLength });

  return localPath;
}

/**
 * Reads text content from a local file. Returns the content for text-based files,
 * or null if the file is binary/unreadable.
 */
async function readTextFile(filePath: string): Promise<string | null> {
  const textExtensions = [
    ".txt", ".md", ".json", ".csv", ".py", ".ts", ".js", ".jsx", ".tsx",
    ".html", ".css", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".sh", ".bash", ".zsh", ".sql", ".rb", ".go", ".rs", ".java",
    ".c", ".cpp", ".h", ".hpp", ".swift", ".kt", ".r", ".lua", ".log"
  ];

  const ext = "." + filePath.split(".").pop()?.toLowerCase();
  if (!textExtensions.includes(ext)) {
    return null;
  }

  try {
    const file = Bun.file(filePath);
    return await file.text();
  } catch {
    return null;
  }
}

// ============================================================================
// Tmp File Cleanup
// ============================================================================

/**
 * Cleans up files older than maxAgeMs from the tmp/ directory.
 * Runs periodically to prevent disk space issues.
 */
async function cleanupTmpFiles(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  const tmpDir = new URL("../tmp", import.meta.url).pathname;
  try {
    const glob = new Bun.Glob("*");
    const now = Date.now();
    for await (const entry of glob.scan({ cwd: tmpDir })) {
      if (entry === ".keep") continue;
      const filePath = `${tmpDir}/${entry}`;
      try {
        const stat = await Bun.file(filePath).stat();
        if (stat && now - stat.mtime.getTime() > maxAgeMs) {
          const { unlinkSync } = await import("node:fs");
          unlinkSync(filePath);
          log.debug("Cleaned up old tmp file", { file: entry });
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // tmp/ dir may not exist yet
  }
}

// Run cleanup every 6 hours
setInterval(() => cleanupTmpFiles().catch(() => {}), 6 * 60 * 60 * 1000);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Detects goals from a user message and automatically tracks them.
 * Runs asynchronously in the background so it doesn't block message responses.
 */
async function detectAndTrackGoals(userId: number, message: string): Promise<void> {
  const goalService = getGoalService();

  const detectedGoals = await goalService.detectGoals(message);

  if (detectedGoals.length === 0) {
    return;
  }

  log.info("Goals detected", { count: detectedGoals.length, userId });

  for (const detected of detectedGoals) {
    const created = await goalService.trackGoal(userId, detected);
    if (created) {
      log.info("Auto-tracked goal", { description: detected.description });
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

// ============================================================================
// Bot Startup
// ============================================================================

/**
 * DEVELOPMENT MODE: Polling
 *
 * In development, we use long polling to receive updates.
 * This is simpler for testing but requires the bot to be actively running.
 *
 * PRODUCTION MODE: Webhook
 *
 * In production, you can use a webhook instead:
 *
 * 1. Set environment variables:
 *    - BOT_MODE=webhook
 *    - WEBHOOK_URL=https://your-domain.com/webhook
 *    - WEBHOOK_SECRET=your_secret_token
 *
 * 2. The webhook server is started in src/index.ts
 *
 * Note: This file exports the bot instance. The entry point (src/index.ts)
 * is responsible for starting the bot with bot.start().
 */

/**
 * Handle a webhook update
 * This is called by the web server when a webhook POST is received
 */
export async function handleWebhookUpdate(update: Update): Promise<void> {
  await bot.handleUpdate(update);
}

export type { Bot };

// Log bot info (don't auto-start here, let index.ts handle it)
log.info("Bot module loaded");
