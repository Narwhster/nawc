import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFolder,
  listEntries,
  moveEntry,
  renameEntry,
  renameNote,
  safePath,
  safeExistingPath,
  writeNote,
} from "../src/workspace.ts";
import { syncSkills } from "../src/skills.ts";

describe("workspace boundaries", () => {
  it("rejects traversal outside a notebook", async () => {
    await expect(safePath("/tmp/notebook", "../secret")).rejects.toThrow("escapes");
  });

  it("rejects existing paths that escape through a symbolic link", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-"));
    const outside = await mkdtemp(path.join(tmpdir(), "outside-"));
    await writeFile(path.join(outside, "secret.ts"), "secret", "utf8");
    await symlink(outside, path.join(root, "linked"));
    await expect(safeExistingPath(root, "linked/secret.ts")).rejects.toThrow("symbolic link");
  });

  it("writes nested HTML notes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-"));
    await writeNote(root, "design/api.html", "<h1>API</h1>");
    await expect(readFile(path.join(root, "design/api.html"), "utf8")).resolves.toBe(
      "<h1>API</h1>",
    );
  });

  it("renames notes without leaving the notebook", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-"));
    await writeNote(root, "draft.html", "<p>Draft</p>");
    await renameNote(root, "draft.html", "design/final.html");
    await expect(readFile(path.join(root, "design/final.html"), "utf8")).resolves.toBe(
      "<p>Draft</p>",
    );
  });

  it("lists empty folders and notes as workspace entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-"));
    await createFolder(root, "ideas");
    await writeNote(root, "design/api.html", "<h1>API</h1>");
    await expect(listEntries(root)).resolves.toEqual([
      { path: "design", type: "folder" },
      { path: "design/api.html", type: "file" },
      { path: "ideas", type: "folder" },
    ]);
  });

  it("moves folders without overwriting an existing entry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-"));
    await createFolder(root, "drafts");
    await renameEntry(root, "drafts", "archive");
    await expect(listEntries(root)).resolves.toEqual([{ path: "archive", type: "folder" }]);
    await createFolder(root, "drafts");
    await expect(renameEntry(root, "drafts", "archive")).rejects.toThrow("already exists");
  });

  it("moves notes between folders and replaces only when requested", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-"));
    await writeNote(root, "draft.html", "draft");
    await writeNote(root, "archive/draft.html", "old");
    await expect(moveEntry(root, "draft.html", "archive/draft.html")).rejects.toThrow(
      "already exists",
    );
    await moveEntry(root, "draft.html", "archive/draft.html", true);
    await expect(readFile(path.join(root, "archive/draft.html"), "utf8")).resolves.toBe("draft");
  });

  it("synchronizes generated plugin skills", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-"));
    const skills = await syncSkills(root, [
      { name: "demo", client: "demo/client", skills: [{ name: "demo", content: "# Demo" }] },
    ]);
    await expect(readFile(path.join(skills, "demo/SKILL.md"), "utf8")).resolves.toContain("# Demo");
  });

  it("refuses to replace a user-owned skill", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-"));
    const directory = path.join(root, ".skills/demo");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "SKILL.md"), "# My skill\n", "utf8");
    await expect(
      syncSkills(root, [
        { name: "demo", client: "demo/client", skills: [{ name: "demo", content: "# Generated" }] },
      ]),
    ).rejects.toThrow("user-owned");
  });
});
