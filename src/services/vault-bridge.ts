// src/services/vault-bridge.ts
// Bridge between Telegram bot and Obsidian vault via Local REST API (port 27124)
//
// Provides read/write/search operations on the vault, enabling:
// - Reading vault files from Telegram
// - Writing task responses from Telegram into the vault
// - Searching vault content
// - Appending to existing files (e.g., TASKS.md)

import { resolve, relative, isAbsolute } from "path";
import { createLogger } from "./logger.js";

const log = createLogger("vault-bridge");

// ── Configuration ─────────────────────────────────────────────────────────

interface VaultConfig {
  apiUrl: string;
  apiKey: string;
}

function loadConfig(): VaultConfig {
  // Read from ~/.env.local (same source as Obsidian plugin)
  const envPath = `${process.env.HOME}/.env.local`;
  let apiUrl = "https://localhost:27124";
  let apiKey = "";

  try {
    const content = require("fs").readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;

      const eqIdx = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key === "OBSIDIAN_REST_API_KEY") apiKey = value;
      if (key === "OBSIDIAN_REST_URL") apiUrl = value;
    }
  } catch (err) {
    log.error("Failed to read ~/.env.local for vault config", { error: String(err) });
  }

  if (!apiKey) {
    log.warn("OBSIDIAN_REST_API_KEY not found in ~/.env.local; vault bridge will not work");
  }

  return { apiUrl, apiKey };
}

let config: VaultConfig | null = null;

function getConfig(): VaultConfig {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

// ── Vault path validation ────────────────────────────────────────────────

const VAULT_ROOT = `${process.env.HOME}/Obsidian`;

// Allowed directory prefixes for write operations (prevent writing to sensitive dirs)
const WRITABLE_PREFIXES = [
  "context/",
  "ideas/",
  "Inbox/",
  "meetings/",
  "planning/",
];

// Blocked patterns (case-insensitive) for all operations
const BLOCKED_PATTERNS_LOWER = [
  ".obsidian/",
  ".obsidian",
  ".env",
  "credentials",
  ".git/",
  ".git",
  ".ssh/",
  ".gnupg/",
];

function validateVaultPath(rawPath: string, operation: "read" | "write"): { valid: boolean; reason?: string } {
  // Reject null bytes
  if (rawPath.includes("\0")) {
    return { valid: false, reason: "Null bytes not allowed in path" };
  }

  // Reject absolute paths
  if (isAbsolute(rawPath)) {
    return { valid: false, reason: "Absolute paths not allowed" };
  }

  // Resolve against vault root and verify containment
  const vaultRoot = resolve(VAULT_ROOT);
  const resolved = resolve(vaultRoot, rawPath);
  const rel = relative(vaultRoot, resolved);

  // If relative path starts with ".." or is absolute, it escapes the vault
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { valid: false, reason: "Path escapes vault boundary" };
  }

  // Case-insensitive blocklist check (HFS+ is case-insensitive)
  const lowerRel = rel.toLowerCase();
  for (const pattern of BLOCKED_PATTERNS_LOWER) {
    if (lowerRel.includes(pattern)) {
      return { valid: false, reason: `Access to ${pattern} is blocked` };
    }
  }

  // For write operations, restrict to allowed prefixes (case-insensitive)
  if (operation === "write") {
    const isAllowed = WRITABLE_PREFIXES.some(
      prefix => lowerRel.startsWith(prefix.toLowerCase())
    );
    if (!isAllowed) {
      return {
        valid: false,
        reason: `Write operations restricted to: ${WRITABLE_PREFIXES.join(", ")}`,
      };
    }
  }

  return { valid: true };
}

// ── HTTP client for Obsidian REST API ────────────────────────────────────

async function vaultFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const { apiUrl, apiKey } = getConfig();

  if (!apiKey) {
    throw new Error("Vault API key not configured. Check ~/.env.local");
  }

  const url = `${apiUrl}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    ...((options.headers as Record<string, string>) || {}),
  };

  // Use Bun's per-request TLS option for the self-signed localhost cert.
  // This avoids mutating the global NODE_TLS_REJECT_UNAUTHORIZED env var,
  // which would affect all concurrent outbound HTTPS requests.
  const response = await fetch(url, {
    ...options,
    headers,
    tls: { rejectUnauthorized: false },
  });
  return response;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Check if the vault bridge is configured and Obsidian is reachable.
 */
export async function isVaultAvailable(): Promise<boolean> {
  try {
    const { apiKey } = getConfig();
    if (!apiKey) return false;

    const response = await vaultFetch("/", { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Read a file from the vault.
 */
export async function readVaultFile(path: string): Promise<string> {
  const validation = validateVaultPath(path, "read");
  if (!validation.valid) {
    throw new Error(`Path validation failed: ${validation.reason}`);
  }

  const encodedPath = encodeURIComponent(path).replace(/%2F/g, "/");
  const response = await vaultFetch(`/vault/${encodedPath}`, {
    method: "GET",
    headers: { Accept: "text/markdown" },
  });

  if (!response.ok) {
    const body = await response.text();
    log.error("Vault read failed", { path: encodedPath, status: response.status, body });
    throw new Error(`Failed to read vault file (HTTP ${response.status})`);
  }

  return response.text();
}

/**
 * Write (create/overwrite) a file in the vault.
 */
export async function writeVaultFile(path: string, content: string): Promise<void> {
  const validation = validateVaultPath(path, "write");
  if (!validation.valid) {
    throw new Error(`Path validation failed: ${validation.reason}`);
  }

  const encodedPath = encodeURIComponent(path).replace(/%2F/g, "/");
  const response = await vaultFetch(`/vault/${encodedPath}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: content,
  });

  if (!response.ok) {
    const body = await response.text();
    log.error("Vault write failed", { path: encodedPath, status: response.status, body });
    throw new Error(`Failed to write vault file (HTTP ${response.status})`);
  }

  log.info("Wrote vault file", { path: encodedPath });
}

/**
 * Append content to an existing vault file.
 */
export async function appendVaultFile(path: string, content: string): Promise<void> {
  const validation = validateVaultPath(path, "write");
  if (!validation.valid) {
    throw new Error(`Path validation failed: ${validation.reason}`);
  }

  const encodedPath = encodeURIComponent(path).replace(/%2F/g, "/");
  const response = await vaultFetch(`/vault/${encodedPath}`, {
    method: "POST",
    headers: { "Content-Type": "text/markdown" },
    body: content,
  });

  if (!response.ok) {
    const body = await response.text();
    log.error("Vault append failed", { path: encodedPath, status: response.status, body });
    throw new Error(`Failed to append to vault file (HTTP ${response.status})`);
  }

  log.info("Appended to vault file", { path: encodedPath });
}

/**
 * Search the vault using Obsidian's search.
 */
export async function searchVault(query: string): Promise<string[]> {
  if (!query || query.length < 2) {
    throw new Error("Search query must be at least 2 characters");
  }

  // Sanitize query: remove control characters
  const sanitized = query.replace(/[\x00-\x1f]/g, "").slice(0, 200);

  const response = await vaultFetch(
    `/search/simple/?query=${encodeURIComponent(sanitized)}`,
    { method: "POST" }
  );

  if (!response.ok) {
    const body = await response.text();
    log.error("Vault search failed", { query: sanitized, status: response.status, body });
    throw new Error(`Vault search failed (HTTP ${response.status})`);
  }

  const results = await response.json() as Array<{ filename: string; matches?: unknown[] }>;
  return results.map(r => r.filename).slice(0, 10);
}

/**
 * Create a response file in the vault from a Telegram message.
 * Writes to context/telegram-responses/ with proper frontmatter.
 */
export async function createTelegramResponse(
  content: string,
  originalQuestion?: string
): Promise<string> {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `context/telegram-responses/${timestamp}.md`;

  // Sanitize question text: strip control chars and newlines to prevent YAML injection
  const safeQuestion = originalQuestion
    ? originalQuestion.replace(/[\n\r\t\x00-\x1f]/g, " ").replace(/"/g, '\\"').slice(0, 200)
    : undefined;

  const frontmatter = [
    "---",
    "type: telegram-response",
    `created: ${now.toISOString()}`,
    "source: telegram",
    "status: pending",
    safeQuestion ? `original-question: "${safeQuestion}"` : null,
    "---",
    "",
  ].filter(Boolean).join("\n");

  const fileContent = `${frontmatter}\n${content}\n`;

  await writeVaultFile(fileName, fileContent);
  return fileName;
}

/**
 * Add a task to TASKS.md in the vault.
 */
export async function addVaultTask(taskDescription: string): Promise<void> {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const taskEntry = `\n- [ ] ${taskDescription} _(added via Telegram, ${dateStr})_\n`;

  await appendVaultFile("context/TASKS.md", taskEntry);
  log.info("Added task to vault", { task: taskDescription.slice(0, 50) });
}

/**
 * Create an idea file in the vault.
 */
export async function createVaultIdea(
  content: string,
  domain: string = "dev"
): Promise<string> {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `ideas/${timestamp}-telegram.md`;

  const fileContent = [
    "---",
    "type: idea",
    `created: ${now.toISOString()}`,
    `domain: ${domain}`,
    "status: new",
    "source: telegram",
    "confidence: 0.8",
    "---",
    "",
    content,
    "",
  ].join("\n");

  await writeVaultFile(fileName, fileContent);
  return fileName;
}

/**
 * Get a summary of the current vault status.
 * Reads TASKS.md and returns active tasks count.
 */
export async function getVaultStatus(): Promise<string> {
  const parts: string[] = [];

  try {
    const tasks = await readVaultFile("context/TASKS.md");
    const activeCount = (tasks.match(/- \[ \]/g) || []).length;
    const completedCount = (tasks.match(/- \[x\]/g) || []).length;
    parts.push(`Tasks: ${activeCount} active, ${completedCount} completed`);

    // Show first few active tasks
    const lines = tasks.split("\n");
    const activeTasks = lines
      .filter(l => l.trim().startsWith("- [ ]"))
      .slice(0, 5)
      .map(l => l.trim());

    if (activeTasks.length > 0) {
      parts.push("\nActive tasks:");
      parts.push(...activeTasks);
    }
  } catch {
    parts.push("TASKS.md: not accessible");
  }

  // Check for pending telegram responses
  try {
    const response = await vaultFetch(
      `/vault/?list=true&folder=${encodeURIComponent("context/telegram-responses")}`,
      { method: "GET" }
    );
    if (response.ok) {
      const listing = await response.json() as { files?: string[] };
      const count = listing.files?.length || 0;
      if (count > 0) {
        parts.push(`\nPending Telegram responses: ${count}`);
      }
    }
  } catch {
    // Directory may not exist yet
  }

  const available = await isVaultAvailable();
  parts.unshift(available ? "Obsidian: connected" : "Obsidian: offline");

  return parts.join("\n");
}
