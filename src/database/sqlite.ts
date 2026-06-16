/**
 * SQLite Connection
 *
 * Opens and manages the bot's local SQLite database (replaces the former
 * Supabase/Postgres backend). The database is a single file that lives outside
 * any Syncthing-synced folder so it is never replicated while open (which would
 * corrupt it). Only the always-on host runs the bot, so the DB is local state.
 *
 * Path resolution:
 *   1. BOT_DB_PATH env var, if set (used by tests and custom deployments).
 *   2. Otherwise ~/Library/Application Support/claudecode-bot/bot.db (macOS).
 */

import { Database } from "bun:sqlite";
import { homedir } from "os";
import { dirname, join } from "path";
import { mkdirSync } from "fs";
import { applySchema } from "./schema.js";

/** The bot's database handle type. Replaces the former `SupabaseClient`. */
export type BotDatabase = Database;

/**
 * Resolves the on-disk location of the database file.
 */
export function resolveDbPath(): string {
  const fromEnv = process.env.BOT_DB_PATH;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return join(
    homedir(),
    "Library",
    "Application Support",
    "claudecode-bot",
    "bot.db",
  );
}

/**
 * Opens a database at the given path, ensuring the parent directory exists,
 * enabling WAL + foreign keys, and applying the schema. Pass ":memory:" for
 * an ephemeral in-memory database (used by tests).
 */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  // NORMAL is the durable, recommended setting under WAL and avoids an fsync
  // per commit; busy_timeout makes a brief lock wait instead of throwing
  // SQLITE_BUSY. Both harden the long-running launchd process.
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  applySchema(db);
  return db;
}

let singleton: Database | null = null;

/**
 * Returns the process-wide singleton database handle, opening it on first use.
 */
export function getDb(): Database {
  if (!singleton) {
    singleton = openDatabase(resolveDbPath());
  }
  return singleton;
}

/**
 * Closes and clears the singleton (used in tests and graceful shutdown).
 */
export function closeDb(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
