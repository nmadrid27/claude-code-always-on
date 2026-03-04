#!/usr/bin/env bun
// src/mcp/telegram-approver.ts
//
// MCP server that delegates Claude Code permission prompts to Telegram.
// Speaks MCP protocol (JSON-RPC 2.0) over stdio.
// Spawned by Claude Code via --permission-prompt-tool flag.
//
// Flow:
//   1. Claude Code calls this tool when it needs permission
//   2. This server sends a Telegram message with Allow/Deny buttons
//   3. The always-on bot handles the button callback and writes a response file
//   4. This server reads the response and returns allow/deny to Claude Code
//
// IPC: File-based via ~/.claude/approvals/<uuid>.{request,response}.json

import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, lstatSync } from "fs";
import { resolve } from "path";

// ── Configuration ─────────────────────────────────────────────────────────

const HOME = process.env.HOME;
if (!HOME) {
  process.stderr.write("[telegram-approver] FATAL: HOME environment variable is not set\n");
  process.exit(1);
}

const APPROVALS_DIR = resolve(HOME, ".claude/approvals");
const BOT_ENV_FILE = resolve(HOME, "claude-code-always-on/.env");
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes auto-deny

// Ensure approvals directory exists with restrictive permissions
if (!existsSync(APPROVALS_DIR)) {
  mkdirSync(APPROVALS_DIR, { recursive: true, mode: 0o700 });
}

// Verify approvals directory is not a symlink (prevents redirection attacks)
try {
  const stat = lstatSync(APPROVALS_DIR);
  if (stat.isSymbolicLink()) {
    process.stderr.write("[telegram-approver] FATAL: Approvals directory is a symlink; refusing to use it\n");
    process.exit(1);
  }
} catch {
  process.stderr.write("[telegram-approver] FATAL: Cannot stat approvals directory\n");
  process.exit(1);
}

// ── Load Telegram credentials ─────────────────────────────────────────────

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

function loadTelegramConfig(): TelegramConfig {
  let botToken = "";
  let chatId = "";

  try {
    const content = readFileSync(BOT_ENV_FILE, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;

      const eqIdx = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key === "TELEGRAM_BOT_TOKEN") botToken = value;
      if (key === "ALLOWED_USER_IDS") chatId = value.split(",")[0]!.trim();
    }
  } catch {
    logError("Failed to read bot .env file");
  }

  if (!botToken || !chatId) {
    logError("Missing TELEGRAM_BOT_TOKEN or ALLOWED_USER_IDS");
    process.exit(1);
  }

  return { botToken, chatId };
}

const telegramConfig = loadTelegramConfig();

// ── Logging (stderr only, stdout is MCP protocol) ─────────────────────────

function logInfo(msg: string) {
  process.stderr.write(`[telegram-approver] ${msg}\n`);
}

function logError(msg: string) {
  // M-3 fix: Redact bot tokens from error messages before logging
  const redacted = msg.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]");
  process.stderr.write(`[telegram-approver] ERROR: ${redacted}\n`);
}

// ── Telegram API ──────────────────────────────────────────────────────────

async function sendApprovalMessage(
  requestId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  workingDir: string
): Promise<void> {
  // Format the tool input for display (sanitize and truncate)
  let inputDisplay = "";
  if (toolName === "Bash" && typeof toolInput.command === "string") {
    inputDisplay = toolInput.command.slice(0, 300);
  } else if (toolName === "Edit" || toolName === "Write") {
    const filePath = (toolInput.file_path as string) || "unknown";
    inputDisplay = `File: ${filePath}`;
  } else {
    inputDisplay = JSON.stringify(toolInput).slice(0, 300);
  }

  // Strip any characters that could break Telegram message formatting
  inputDisplay = inputDisplay.replace(/[`]/g, "'");

  const dirName = workingDir.split("/").pop() || workingDir;

  const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const message =
    `Permission Request\n\n` +
    `Tool: ${toolName}\n` +
    `Session: ${dirName}\n` +
    `Time: ${time}\n\n` +
    `${inputDisplay}`;

  const url = `https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`;

  const body = {
    chat_id: telegramConfig.chatId,
    text: message,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Allow", callback_data: `perm_allow:${requestId}` },
          { text: "Deny", callback_data: `perm_deny:${requestId}` },
        ],
        [
          { text: "Allow All Similar", callback_data: `perm_allow_tool:${requestId}:${toolName}` },
        ],
      ],
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logError(`Telegram API error: ${response.status} ${text}`);
  }
}

async function editApprovalMessage(
  requestId: string,
  decision: string
): Promise<void> {
  // We don't track message IDs for simplicity; the callback handler in the bot
  // answers the callback query with a toast notification instead.
}

// ── IPC: File-based approval flow ─────────────────────────────────────────

interface ApprovalRequest {
  id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  working_directory: string;
  timestamp: string;
}

interface ApprovalResponse {
  id: string;
  behavior: "allow" | "deny";
  tool_name?: string;
  message?: string;
  timestamp: string;
}

function writeApprovalRequest(request: ApprovalRequest): void {
  const filePath = resolve(APPROVALS_DIR, `${request.id}.request.json`);
  writeFileSync(filePath, JSON.stringify(request), { mode: 0o600 });
}

function pollForResponse(requestId: string): Promise<ApprovalResponse> {
  return new Promise((resolvePromise, reject) => {
    const responsePath = resolve(APPROVALS_DIR, `${requestId}.response.json`);
    const requestPath = resolve(APPROVALS_DIR, `${requestId}.request.json`);
    const startTime = Date.now();

    const interval = setInterval(() => {
      // Check timeout
      if (Date.now() - startTime > TIMEOUT_MS) {
        clearInterval(interval);
        cleanup(requestId);
        resolvePromise({
          id: requestId,
          behavior: "deny",
          message: "Timed out waiting for approval (5 minutes)",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Check for response file
      if (existsSync(responsePath)) {
        try {
          const content = readFileSync(responsePath, "utf-8");
          const parsed = JSON.parse(content) as Record<string, unknown>;

          // Validate response schema before trusting it
          if (parsed.behavior !== "allow" && parsed.behavior !== "deny") {
            throw new Error(`Invalid behavior value: ${parsed.behavior}`);
          }
          const response: ApprovalResponse = {
            id: String(parsed.id || requestId),
            behavior: parsed.behavior,
            ...(typeof parsed.tool_name === "string" ? { tool_name: parsed.tool_name } : {}),
            ...(typeof parsed.message === "string" ? { message: parsed.message } : {}),
            timestamp: String(parsed.timestamp || new Date().toISOString()),
          };

          clearInterval(interval);
          cleanup(requestId);
          resolvePromise(response);
        } catch (err) {
          logError(`Failed to read response file: ${err}`);
          clearInterval(interval);
          cleanup(requestId);
          resolvePromise({
            id: requestId,
            behavior: "deny",
            message: "Failed to read approval response",
            timestamp: new Date().toISOString(),
          });
        }
      }
    }, POLL_INTERVAL_MS);
  });
}

function cleanup(requestId: string): void {
  const requestPath = resolve(APPROVALS_DIR, `${requestId}.request.json`);
  const responsePath = resolve(APPROVALS_DIR, `${requestId}.response.json`);
  try { unlinkSync(requestPath); } catch {}
  try { unlinkSync(responsePath); } catch {}
}

// ── Track "Allow All Similar" decisions (with 30-minute TTL) ──────────────

const ALLOW_ALL_TTL_MS = 30 * 60 * 1000; // 30 minutes
const allowedTools = new Map<string, number>(); // tool name → expiry timestamp

// ── MCP Protocol Handler ──────────────────────────────────────────────────

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

function sendResponse(id: string | number | undefined, result: unknown): void {
  const response: JsonRpcMessage = {
    jsonrpc: "2.0",
    id,
    result,
  };
  const json = JSON.stringify(response);
  process.stdout.write(json + "\n");
}

function sendError(id: string | number | undefined, code: number, message: string): void {
  const response: JsonRpcMessage = {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
  process.stdout.write(JSON.stringify(response) + "\n");
}

async function handleMessage(msg: JsonRpcMessage): Promise<void> {
  // Notifications (no id) don't need responses
  if (msg.id === undefined && msg.method === "notifications/initialized") {
    logInfo("Client initialized");
    return;
  }

  switch (msg.method) {
    case "initialize": {
      sendResponse(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "telegram-approver",
          version: "1.0.0",
        },
      });
      break;
    }

    case "tools/list": {
      sendResponse(msg.id, {
        tools: [
          {
            name: "approve",
            description:
              "Sends a permission request to the user via Telegram and waits for approval. " +
              "Returns {behavior: 'allow'} or {behavior: 'deny', message: '...'}.",
            inputSchema: {
              type: "object",
              properties: {
                tool_name: {
                  type: "string",
                  description: "Name of the tool requesting permission",
                },
                tool_input: {
                  type: "object",
                  description: "Input parameters of the tool",
                },
                working_directory: {
                  type: "string",
                  description: "Working directory of the session",
                },
              },
              required: ["tool_name", "tool_input"],
            },
          },
        ],
      });
      break;
    }

    case "tools/call": {
      const params = msg.params || {};
      const toolName = params.name as string;

      if (toolName !== "approve") {
        sendError(msg.id, -32601, `Unknown tool: ${toolName}`);
        return;
      }

      const args = (params.arguments || {}) as Record<string, unknown>;
      const requestedTool = (args.tool_name as string) || "unknown";
      const toolInput = (args.tool_input as Record<string, unknown>) || {};
      const workingDir = (args.working_directory as string) || process.cwd();

      // Check if this tool type was previously "Allow All"-ed (with TTL)
      const expiry = allowedTools.get(requestedTool);
      if (expiry !== undefined) {
        if (Date.now() < expiry) {
          logInfo(`Auto-allowing ${requestedTool} (approved until ${new Date(expiry).toISOString()})`);
          sendResponse(msg.id, {
            content: [
              {
                type: "text",
                text: JSON.stringify({ behavior: "allow" }),
              },
            ],
          });
          return;
        }
        // TTL expired; remove and prompt again
        allowedTools.delete(requestedTool);
        logInfo(`Auto-allow expired for ${requestedTool}; prompting again`);
      }

      logInfo(`Permission requested for ${requestedTool}`);

      const requestId = randomUUID();
      const request: ApprovalRequest = {
        id: requestId,
        tool_name: requestedTool,
        tool_input: toolInput,
        working_directory: workingDir,
        timestamp: new Date().toISOString(),
      };

      // Write request file and send Telegram message
      writeApprovalRequest(request);

      try {
        await sendApprovalMessage(requestId, requestedTool, toolInput, workingDir);
      } catch (err) {
        logError(`Failed to send Telegram message: ${err}`);
        cleanup(requestId);
        sendResponse(msg.id, {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                behavior: "deny",
                message: "Failed to send approval request to Telegram",
              }),
            },
          ],
        });
        return;
      }

      // Wait for response
      const approval = await pollForResponse(requestId);

      // Track "allow all" decisions with TTL
      if (approval.behavior === "allow" && approval.tool_name) {
        const expiresAt = Date.now() + ALLOW_ALL_TTL_MS;
        allowedTools.set(approval.tool_name, expiresAt);
        logInfo(`Auto-allowing future ${approval.tool_name} calls for 30 minutes`);
      }

      sendResponse(msg.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              behavior: approval.behavior,
              ...(approval.message ? { message: approval.message } : {}),
            }),
          },
        ],
      });
      break;
    }

    default: {
      if (msg.id !== undefined) {
        sendError(msg.id, -32601, `Method not found: ${msg.method}`);
      }
    }
  }
}

// ── Stdin reader (line-delimited JSON-RPC) ────────────────────────────────

async function main(): Promise<void> {
  logInfo("Starting Telegram approval MCP server");

  // Ensure clean state: remove any stale approval files
  try {
    const { readdirSync } = await import("fs");
    for (const file of readdirSync(APPROVALS_DIR)) {
      if (file.endsWith(".json")) {
        try { unlinkSync(resolve(APPROVALS_DIR, file)); } catch {}
      }
    }
  } catch {}

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        await handleMessage(msg);
      } catch (err) {
        logError(`Failed to parse message: ${err}`);
      }
    }
  }

  logInfo("Stdin closed, shutting down");
}

main().catch((err) => {
  logError(`Fatal error: ${err}`);
  process.exit(1);
});
