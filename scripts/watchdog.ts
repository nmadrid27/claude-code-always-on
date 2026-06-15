// scripts/watchdog.ts
//
// Self-healing watchdog for the always-on bot. Runs periodically (via launchd
// com.claudecode.watchdog). KeepAlive already restarts a *crashed* bot; this
// catches the other failure mode: a bot that is still running but wedged
// (network stall, deadlock) so its heartbeat has gone stale. When that happens
// it force-restarts the bot and sends one Telegram alert.

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

/** Heartbeat is considered stale after 15 minutes (heartbeat updates every 5). */
export const HEARTBEAT_STALE_MS = 15 * 60 * 1000;

/** Minimum gap between repeated alerts for the same outage. */
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

const PROJECT_DIR = join(import.meta.dir, "..");
const HEARTBEAT_FILE = join(PROJECT_DIR, "logs", "heartbeat.timestamp");
const LAST_ALERT_FILE = join(PROJECT_DIR, "logs", "watchdog-last-alert.timestamp");
const LOG_FILE = join(PROJECT_DIR, "logs", "watchdog.log");

/**
 * Pure staleness check.
 * @param heartbeatEpochSeconds the heartbeat timestamp (epoch seconds) or null if absent
 * @param nowMs current time in ms
 * @param thresholdMs staleness threshold in ms (default HEARTBEAT_STALE_MS)
 */
export function isHeartbeatStale(
  heartbeatEpochSeconds: number | null,
  nowMs: number,
  thresholdMs: number = HEARTBEAT_STALE_MS,
): boolean {
  if (heartbeatEpochSeconds === null || Number.isNaN(heartbeatEpochSeconds)) {
    return true;
  }
  return nowMs - heartbeatEpochSeconds * 1000 > thresholdMs;
}

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    writeFileSync(LOG_FILE, line, { flag: "a" });
  } catch {
    /* best effort */
  }
  console.log(line.trim());
}

function readHeartbeat(): number | null {
  if (!existsSync(HEARTBEAT_FILE)) return null;
  try {
    const raw = readFileSync(HEARTBEAT_FILE, "utf8").trim();
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

function readLastAlert(): number {
  if (!existsSync(LAST_ALERT_FILE)) return 0;
  try {
    return parseInt(readFileSync(LAST_ALERT_FILE, "utf8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function sendTelegramAlert(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ids = (process.env.ALLOWED_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!token || ids.length === 0) {
    log("Cannot send alert: TELEGRAM_BOT_TOKEN or ALLOWED_USER_IDS missing");
    return;
  }
  for (const chatId of ids) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    } catch (err) {
      log(`Failed to send alert to ${chatId}: ${String(err)}`);
    }
  }
}

function restartBot(): void {
  const uid = process.getuid ? process.getuid() : 501;
  try {
    Bun.spawnSync([
      "launchctl",
      "kickstart",
      "-k",
      `gui/${uid}/com.claudecode.bot`,
    ]);
    log("Issued launchctl kickstart -k for com.claudecode.bot");
  } catch (err) {
    log(`Failed to kickstart bot: ${String(err)}`);
  }
}

async function main(): Promise<void> {
  const now = Date.now();
  const hb = readHeartbeat();

  if (!isHeartbeatStale(hb, now)) {
    return; // healthy; stay quiet
  }

  const ageMin = hb === null ? "n/a" : Math.round((now - hb * 1000) / 60000);
  log(`Heartbeat stale (age=${ageMin}min). Restarting bot.`);
  restartBot();

  // Rate-limit alerts so a persistent outage does not spam Telegram.
  if (now - readLastAlert() > ALERT_COOLDOWN_MS) {
    await sendTelegramAlert(
      `⚠️ PopPop watchdog: heartbeat was stale (age ${ageMin} min). Restarted the bot. If this repeats, check logs on the mini.`,
    );
    try {
      writeFileSync(LAST_ALERT_FILE, String(now));
    } catch {
      /* best effort */
    }
  }
}

if (import.meta.main) {
  await main();
}
