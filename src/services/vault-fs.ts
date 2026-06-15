// src/services/vault-fs.ts
//
// Filesystem-based Obsidian vault search. READ-ONLY: it walks the vault
// directory on disk and greps markdown files. It deliberately does NOT touch
// the Obsidian Local REST API (port 27124) or the vault MCP server (port
// 22360), so it cannot interfere with either; it only reads files that are
// already on disk (synced via Syncthing). This means vault search works even
// when the Obsidian app is closed.

import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve, relative, basename } from "path";

export interface VaultFsHit {
  /** Path relative to the vault root. */
  path: string;
  /** 1-based line number of the first matching line. */
  line: number;
  /** Trimmed (and possibly truncated) matching line. */
  snippet: string;
  /** Internal ranking score (higher = more relevant). */
  score: number;
}

export interface VaultFsSearchOptions {
  vaultRoot?: string;
  maxResults?: number;
  maxSnippetLen?: number;
  /** Skip files larger than this many bytes (skip oversized non-notes). */
  maxFileBytes?: number;
}

/** Directory names never searched (config, vcs, sync metadata, trash). */
const EXCLUDED_DIRS = new Set([
  ".obsidian",
  ".git",
  ".trash",
  ".smart-env",
  ".stversions",
  ".stfolder",
  "node_modules",
]);

/**
 * Resolves the vault root: OBSIDIAN_VAULT_PATH env override, else ~/Obsidian.
 */
export function resolveVaultRoot(): string {
  const fromEnv = process.env.OBSIDIAN_VAULT_PATH;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return `${process.env.HOME}/Obsidian`;
}

function isMarkdown(name: string): boolean {
  // Skip Syncthing conflict duplicates (stale copies, not real notes).
  if (name.includes(".sync-conflict-")) return false;
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

/**
 * Recursively collects markdown file paths under root, skipping excluded dirs
 * and symlinks (so a symlink cannot escape the vault boundary).
 */
function collectMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Never follow symlinks (avoids escaping the vault and cycles).
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name.toLowerCase())) continue;
        walk(full);
      } else if (entry.isFile() && isMarkdown(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * Searches the vault filesystem for markdown notes matching ALL whitespace-
 * separated terms in the query (case-insensitive). Filename/title matches rank
 * above body-only matches.
 */
export async function searchVaultFilesystem(
  query: string,
  options: VaultFsSearchOptions = {},
): Promise<VaultFsHit[]> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // Require at least 2 characters of meaningful query, like the REST search.
  if (query.trim().length < 2 || terms.length === 0) return [];

  const root = resolve(options.vaultRoot ?? resolveVaultRoot());
  const maxResults = options.maxResults ?? 10;
  const maxSnippetLen = options.maxSnippetLen ?? 160;
  const maxFileBytes = options.maxFileBytes ?? 2_000_000;

  const files = collectMarkdownFiles(root);
  const hits: VaultFsHit[] = [];

  for (const file of files) {
    let content: string;
    try {
      if (statSync(file).size > maxFileBytes) continue;
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const lowerContent = content.toLowerCase();
    const relPath = relative(root, file);
    const lowerName = basename(file).toLowerCase();

    // A file matches if EVERY term appears in its title or body (the note's
    // filename is part of its searchable identity in Obsidian).
    const haystack = `${lowerContent}\n${lowerName}`;
    if (!terms.every((t) => haystack.includes(t))) continue;

    // First line containing any term -> snippet.
    const lines = content.split("\n");
    let snippetLine = 0;
    let snippet = "";
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i]!.toLowerCase();
      if (terms.some((t) => lower.includes(t))) {
        snippetLine = i + 1;
        snippet = truncate(lines[i]!.trim(), maxSnippetLen);
        break;
      }
    }

    // Score: term occurrences in body + large boost if all terms are in the
    // filename/title.
    let occurrences = 0;
    for (const t of terms) {
      let idx = lowerContent.indexOf(t);
      while (idx !== -1) {
        occurrences++;
        idx = lowerContent.indexOf(t, idx + t.length);
      }
    }
    // Strongest signal: the note's title (filename without extension) is
    // exactly the query. Next: all terms appear in the filename. Then body hits.
    const stem = lowerName.replace(/\.(md|markdown)$/i, "");
    const exactTitleBoost = stem === query.toLowerCase().trim() ? 10000 : 0;
    const filenameBoost = terms.every((t) => lowerName.includes(t)) ? 1000 : 0;

    hits.push({
      path: relPath,
      line: snippetLine || 1,
      snippet,
      score: exactTitleBoost + filenameBoost + occurrences,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, maxResults);
}

/**
 * Formats filesystem hits for a Telegram reply.
 */
export function formatVaultFsHits(hits: VaultFsHit[], query: string): string {
  if (hits.length === 0) return "No results found.";
  const lines = hits.map((h, i) => {
    const loc = `\`${h.path}\``;
    return h.snippet ? `${i + 1}. ${loc}\n   ${h.snippet}` : `${i + 1}. ${loc}`;
  });
  return `Vault search (filesystem) for "${query}":\n\n${lines.join("\n")}`;
}
