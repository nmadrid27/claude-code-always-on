// src/services/logger.ts
// Structured JSON logger with levels, component tags, and timestamps

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: number =
  LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) ?? "info"] ?? LOG_LEVELS.info;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, component: string, message: string, meta?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < currentLevel) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
    ...meta,
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Creates a logger scoped to a specific component.
 *
 * @param component - Component name (e.g., "bot", "relay", "index")
 */
export function createLogger(component: string): Logger {
  return {
    debug: (msg, meta) => emit("debug", component, msg, meta),
    info: (msg, meta) => emit("info", component, msg, meta),
    warn: (msg, meta) => emit("warn", component, msg, meta),
    error: (msg, meta) => emit("error", component, msg, meta),
  };
}
