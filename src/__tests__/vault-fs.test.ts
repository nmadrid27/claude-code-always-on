// src/__tests__/vault-fs.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { searchVaultFilesystem } from "../services/vault-fs.js";

let vault: string;

function write(rel: string, content: string): void {
  const full = join(vault, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-fs-test-"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("searchVaultFilesystem", () => {
  it("finds a markdown file containing the query with a snippet + line", async () => {
    write("notes/meeting.md", "# Standup\nWe discussed the budget forecast today.\n");
    const hits = await searchVaultFilesystem("budget forecast", { vaultRoot: vault });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.path).toBe("notes/meeting.md");
    expect(hits[0]!.line).toBe(2);
    expect(hits[0]!.snippet).toContain("budget forecast");
  });

  it("is case-insensitive", async () => {
    write("a.md", "The Quarterly Review is due.");
    const hits = await searchVaultFilesystem("quarterly review", { vaultRoot: vault });
    expect(hits).toHaveLength(1);
  });

  it("matches multi-term queries across different lines (AND)", async () => {
    write("project.md", "Line about Project\nAnother line about Alpha\n");
    const hits = await searchVaultFilesystem("project alpha", { vaultRoot: vault });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.path).toBe("project.md");
  });

  it("does not match when only some terms are present", async () => {
    write("partial.md", "Only project here, no second term.");
    const hits = await searchVaultFilesystem("project alpha", { vaultRoot: vault });
    expect(hits).toHaveLength(0);
  });

  it("only searches .md files", async () => {
    write("note.md", "findme in markdown");
    write("data.txt", "findme in text");
    write("image.png", "findme in binary-ish");
    const hits = await searchVaultFilesystem("findme", { vaultRoot: vault });
    expect(hits.map((h) => h.path)).toEqual(["note.md"]);
  });

  it("excludes .obsidian, .git, .trash, .smart-env directories", async () => {
    write(".obsidian/config.md", "secret token");
    write(".git/notes.md", "secret token");
    write(".trash/old.md", "secret token");
    write(".smart-env/x.md", "secret token");
    write("real.md", "secret token");
    const hits = await searchVaultFilesystem("secret token", { vaultRoot: vault });
    expect(hits.map((h) => h.path)).toEqual(["real.md"]);
  });

  it("ranks filename/title matches above body-only matches", async () => {
    write("body-only.md", "some mention of roadmap deep in the text");
    write("roadmap.md", "unrelated content here entirely");
    write("also-roadmap-mention.md", "roadmap appears in body too");
    const hits = await searchVaultFilesystem("roadmap", { vaultRoot: vault });
    // The file whose NAME contains the term should rank first.
    expect(hits[0]!.path).toBe("roadmap.md");
  });

  it("respects maxResults", async () => {
    for (let i = 0; i < 8; i++) write(`n${i}.md`, "common term here");
    const hits = await searchVaultFilesystem("common term", { vaultRoot: vault, maxResults: 3 });
    expect(hits).toHaveLength(3);
  });

  it("returns [] for an empty/too-short query", async () => {
    write("a.md", "anything");
    expect(await searchVaultFilesystem("", { vaultRoot: vault })).toEqual([]);
    expect(await searchVaultFilesystem("a", { vaultRoot: vault })).toEqual([]);
  });

  it("does not follow directory symlinks out of the vault", async () => {
    const outside = mkdtempSync(join(tmpdir(), "vault-fs-outside-"));
    writeFileSync(join(outside, "leak.md"), "secret outside the vault");
    try {
      symlinkSync(outside, join(vault, "escape"), "dir");
      const hits = await searchVaultFilesystem("secret outside", { vaultRoot: vault });
      expect(hits).toHaveLength(0);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("excludes Syncthing sync-conflict duplicate files", async () => {
    write("real.md", "shared content");
    write("real.sync-conflict-20260519-143645-ABC.md", "shared content");
    const hits = await searchVaultFilesystem("shared content", { vaultRoot: vault });
    expect(hits.map((h) => h.path)).toEqual(["real.md"]);
  });

  it("truncates long snippets", async () => {
    const longLine = "match " + "x".repeat(500);
    write("long.md", longLine);
    const hits = await searchVaultFilesystem("match", { vaultRoot: vault, maxSnippetLen: 80 });
    expect(hits[0]!.snippet.length).toBeLessThanOrEqual(81); // allow ellipsis
  });
});
