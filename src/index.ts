// src/index.ts
// Application entry point for Claude Code Always-On

// Bun auto-loads .env, no dotenv needed

import { bot, handleWebhookUpdate } from "./bot.js";
import { startHeartbeat, stopHeartbeat } from "./services/heartbeat.service.js";
import { getProactiveService } from "./services/proactive.js";
import { createWebhookHandlers } from "./services/twilio-webhook.js";
import { createVoiceService } from "./services/voice.js";
import { createMemoryServices } from "./services/memory.js";
import { createLogger } from "./services/logger.js";
import { getGlobalStats } from "./services/cost-tracker.js";
import { verifyTwilioSignature, verifyElevenLabsSignature } from "./middleware/webhook-auth.js";

const log = createLogger("index");

// Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_MODE = process.env.BOT_MODE || "polling"; // 'polling' or 'webhook'
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "3000", 10);

// ============================================================================
// Validation
// ============================================================================

function validateEnvironment(): void {
  const errors: string[] = [];

  if (!TELEGRAM_BOT_TOKEN) {
    errors.push("TELEGRAM_BOT_TOKEN is not set");
  } else if (TELEGRAM_BOT_TOKEN === "your_bot_token_here") {
    errors.push("TELEGRAM_BOT_TOKEN is using placeholder value");
  }

  if (!process.env.ALLOWED_USER_IDS) {
    log.warn("ALLOWED_USER_IDS not set - bot will reject all users");
  }

  if (errors.length > 0) {
    log.error("Environment validation failed", { errors });
    process.exit(1);
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    log.warn("Shutdown already in progress, ignoring signal");
    return;
  }

  isShuttingDown = true;
  log.info("Shutting down gracefully", { signal });

  const shutdownTimeout = setTimeout(() => {
    log.error("Shutdown timeout reached, forcing exit");
    process.exit(1);
  }, 10000);

  try {
    log.info("Stopping proactive check-in service...");
    try {
      const proactiveService = getProactiveService();
      proactiveService.stop();
    } catch {
      // Service may not have been initialized yet
    }

    log.info("Stopping heartbeat service...");
    stopHeartbeat();

    log.info("Stopping bot...");
    await bot.stop();
    log.info("Bot stopped successfully");

    clearTimeout(shutdownTimeout);
    process.exit(0);
  } catch (error) {
    log.error("Error during shutdown", { error: String(error) });
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// Register signal handlers
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Handle uncaught errors
process.on("uncaughtException", (error: Error) => {
  log.error("Uncaught Exception", { message: error.message, stack: error.stack });
  gracefulShutdown("uncaughtException").catch(() => {
    process.exit(1);
  });
});

process.on("unhandledRejection", (reason: unknown) => {
  log.error("Unhandled Rejection", { reason: String(reason) });
  gracefulShutdown("unhandledRejection").catch(() => {
    process.exit(1);
  });
});

// ============================================================================
// Health endpoint helper
// ============================================================================

function buildHealthResponse(): Response {
  const stats = getGlobalStats();
  const uptimeSec = Math.floor(stats.uptimeMs / 1000);
  const body = {
    status: "ok",
    uptime: `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`,
    totalInvocations: stats.totalInvocations,
    totalTokens: stats.totalTokens,
    estimatedCost: `$${stats.totalCost.toFixed(4)}`,
    recentErrors: stats.recentErrors,
  };
  return Response.json(body, { status: 200 });
}

// ============================================================================
// Bot Startup
// ============================================================================

async function startPolling(): Promise<void> {
  log.info("Starting bot in POLLING mode");
  await bot.start();
  log.info("Bot is polling for updates");
}

async function startWebhook(): Promise<void> {
  if (!WEBHOOK_URL) {
    throw new Error("WEBHOOK_URL must be set in webhook mode");
  }

  log.info("Setting up webhook", { url: WEBHOOK_URL });

  await bot.api.setWebhook(WEBHOOK_URL, {
    secret_token: WEBHOOK_SECRET,
  });

  log.info("Webhook configured");

  // Initialize voice webhook handler (lazy - only created if env vars are set)
  let voiceHandlers: ReturnType<typeof createWebhookHandlers> | null = null;
  try {
    const voiceService = createVoiceService();
    const allowedUserIds = (process.env.ALLOWED_USER_IDS || "")
      .split(",")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id));
    const memoryServices = createMemoryServices(allowedUserIds);
    const phoneToUserId = new Map<string, number>();
    const phoneMap = process.env.PHONE_USER_MAP || "";
    for (const entry of phoneMap.split(",").filter(Boolean)) {
      const [phone, userId] = entry.split(":");
      if (phone && userId) {
        phoneToUserId.set(phone.replace(/[\s\-\+]/g, ""), parseInt(userId, 10));
      }
    }
    voiceHandlers = createWebhookHandlers(voiceService, memoryServices, phoneToUserId);
    log.info("Voice webhook handlers initialized");
  } catch {
    log.warn("Voice webhook handlers not initialized (missing config)");
  }

  const server = Bun.serve({
    port: WEBHOOK_PORT,
    fetch: async (req) => {
      const url = new URL(req.url, `http://localhost:${WEBHOOK_PORT}`);
      const pathname = url.pathname;

      // Health check endpoint (enhanced with stats)
      if (req.method === "GET" && pathname === "/health") {
        return buildHealthResponse();
      }

      if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      // ---- Voice webhook routes ----
      if (pathname === "/voice/inbound") {
        if (!voiceHandlers) {
          return new Response("Voice not configured", { status: 503 });
        }
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (!authToken) {
          log.warn("TWILIO_AUTH_TOKEN not set — rejecting /voice/inbound");
          return new Response("Voice not configured", { status: 503 });
        }
        const signature = req.headers.get("x-twilio-signature") ?? "";
        const rawBody = await req.text();
        const params: Record<string, string> = {};
        for (const [k, v] of new URLSearchParams(rawBody)) {
          params[k] = v;
        }
        const verifyUrl = WEBHOOK_URL
          ? `${WEBHOOK_URL.replace(/\/$/, "")}/voice/inbound`
          : req.url;
        if (!verifyTwilioSignature(authToken, signature, verifyUrl, params)) {
          log.warn("Invalid Twilio signature on /voice/inbound");
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const body = params as { CallSid: string; From: string };
          const result = await voiceHandlers.inboundCall({ body });
          return new Response(result.body, {
            status: result.statusCode,
            headers: result.headers,
          });
        } catch (error) {
          log.error("Error handling /voice/inbound", { error: String(error) });
          return new Response("Error", { status: 500 });
        }
      }

      if (pathname === "/voice/status") {
        if (!voiceHandlers) {
          return new Response("Voice not configured", { status: 503 });
        }
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (!authToken) {
          log.warn("TWILIO_AUTH_TOKEN not set — rejecting /voice/status");
          return new Response("Voice not configured", { status: 503 });
        }
        const signature = req.headers.get("x-twilio-signature") ?? "";
        const rawBody = await req.text();
        const params: Record<string, string> = {};
        for (const [k, v] of new URLSearchParams(rawBody)) {
          params[k] = v;
        }
        const verifyUrl = WEBHOOK_URL
          ? `${WEBHOOK_URL.replace(/\/$/, "")}/voice/status`
          : req.url;
        if (!verifyTwilioSignature(authToken, signature, verifyUrl, params)) {
          log.warn("Invalid Twilio signature on /voice/status");
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const body = params as unknown as import("./services/twilio-webhook.js").TwilioCallStatus;
          const result = await voiceHandlers.callStatus({ body });
          return new Response(result.body, { status: result.statusCode });
        } catch (error) {
          log.error("Error handling /voice/status", { error: String(error) });
          return new Response("Error", { status: 500 });
        }
      }

      if (pathname === "/voice/elevenlabs") {
        if (!voiceHandlers) {
          return new Response("Voice not configured", { status: 503 });
        }
        const signingSecret = process.env.ELEVENLABS_SIGNING_SECRET;
        if (!signingSecret) {
          log.warn("ELEVENLABS_SIGNING_SECRET not set — rejecting /voice/elevenlabs");
          return new Response("Voice not configured", { status: 503 });
        }
        const signatureHeader = req.headers.get("elevenlabs-signature") ?? "";
        const rawBody = await req.text();
        if (!verifyElevenLabsSignature(signingSecret, signatureHeader, rawBody)) {
          log.warn("Invalid ElevenLabs signature on /voice/elevenlabs");
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const body = JSON.parse(rawBody) as import("./services/twilio-webhook.js").ElevenLabsAgentEvent;
          const result = await voiceHandlers.agentEvent({ body });
          return new Response(result.body, { status: result.statusCode });
        } catch (error) {
          log.error("Error handling /voice/elevenlabs", { error: String(error) });
          return new Response("Error", { status: 500 });
        }
      }

      // ---- Telegram webhook route (default POST) ----
      if (WEBHOOK_SECRET) {
        const signature = req.headers.get("x-telegram-bot-api-secret-token");
        if (signature !== WEBHOOK_SECRET) {
          log.warn("Invalid webhook secret token");
          return new Response("Unauthorized", { status: 401 });
        }
      }

      try {
        const body = await req.json() as import("grammy/types").Update;
        await handleWebhookUpdate(body);
        return new Response("OK", { status: 200 });
      } catch (error) {
        log.error("Error handling webhook update", { error: String(error) });
        return new Response("Error", { status: 500 });
      }
    },
  });

  log.info("Webhook server listening", { port: server.port });
}

async function startBot(): Promise<void> {
  log.info("Claude Code Always-On - Starting");

  validateEnvironment();
  startHeartbeat();

  try {
    const botInfo = await bot.api.getMe();
    log.info("Bot info retrieved", { username: botInfo.username, id: botInfo.id });
  } catch (error) {
    log.error("Failed to get bot info", { error: String(error) });
    throw error;
  }

  if (BOT_MODE === "webhook") {
    await startWebhook();
  } else {
    await startPolling();
  }

  try {
    const proactiveService = getProactiveService(bot);
    proactiveService.start();
    log.info("Proactive check-in service started");
  } catch (error) {
    log.warn("Failed to start proactive check-in service", { error: String(error) });
  }

  log.info("Bot is running", { mode: BOT_MODE.toUpperCase() });
}

// ============================================================================
// Main Entry Point
// ============================================================================

startBot().catch((error) => {
  log.error("Failed to start bot", { error: String(error) });
  process.exit(1);
});
