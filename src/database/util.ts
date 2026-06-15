/**
 * Database utilities shared by the SQLite repositories.
 *
 * Embeddings are stored as JSON arrays in TEXT columns; metadata as JSON
 * objects in TEXT columns. Ids are application-generated UUIDs and timestamps
 * are ISO-8601 strings, matching the shapes the rest of the codebase expects
 * from the former Postgres backend.
 */

import { randomUUID } from "crypto";

/** Generates a new row id (UUID v4). */
export function newId(): string {
  return randomUUID();
}

/** Current timestamp as an ISO-8601 string (UTC). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Serializes an embedding vector for storage, or null when absent/empty. */
export function serializeVector(v?: number[] | null): string | null {
  return v && v.length > 0 ? JSON.stringify(v) : null;
}

/** Parses a stored embedding back into a number array, or undefined. */
export function parseVector(s: unknown): number[] | undefined {
  if (typeof s !== "string" || s.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as number[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Serializes a metadata object for storage (defaults to "{}"). */
export function serializeJson(o?: Record<string, unknown> | null): string {
  return JSON.stringify(o ?? {});
}

/** Parses a stored JSON object, defaulting to {} on null/invalid input. */
export function parseJson(s: unknown): Record<string, unknown> {
  if (typeof s !== "string" || s.length === 0) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
