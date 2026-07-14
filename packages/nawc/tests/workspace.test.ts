import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  createFolder,
  isProjectFile,
  isProjectPath,
  listEntries,
  listProjectFiles,
  listProjectPaths,
  moveEntry,
  renameEntry,
  renameNote,
  safePath,
  safeExistingPath,
  writeNote,
} from "../src/workspace.ts";
import { syncSkills } from "../src/skills.ts";

const execFileAsync = promisify(execFile);

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

  it("lists project files through Git while excluding ignored and generated content", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-project-"));
    await execFileAsync("git", ["init", root]);
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "dist"));
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, ".gitignore"), "*.secret\n", "utf8");
    await writeFile(path.join(root, "src/index.ts"), "export {};", "utf8");
    await writeFile(path.join(root, "local.secret"), "secret", "utf8");
    await writeFile(path.join(root, "dist/tracked.js"), "generated", "utf8");
    await writeFile(path.join(root, "node_modules/tracked.js"), "generated", "utf8");
    await execFileAsync("git", [
      "-C",
      root,
      "add",
      "-f",
      "dist/tracked.js",
      "node_modules/tracked.js",
    ]);
    await expect(listProjectFiles(root)).resolves.toEqual([".gitignore", "src/index.ts"]);
    await expect(listProjectPaths(root)).resolves.toEqual([
      { path: ".gitignore", kind: "file" },
      { path: "src", kind: "directory" },
      { path: "src/index.ts", kind: "file" },
    ]);
    await expect(isProjectPath(root, "src")).resolves.toBe(true);
  });

  it("bounds project file results while skipping unsafe candidates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-large-project-"));
    const outside = await mkdtemp(path.join(tmpdir(), "nawc-outside-"));
    await execFileAsync("git", ["init", root]);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(outside, "secret.ts"), "secret", "utf8");
    await symlink(path.join(outside, "secret.ts"), path.join(root, "src/000.ts"));
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        writeFile(
          path.join(root, `src/${String(index + 1).padStart(3, "0")}.ts`),
          "export {};",
          "utf8",
        ),
      ),
    );
    await expect(listProjectFiles(root, { query: "src/", limit: 5 })).resolves.toEqual([
      "src/001.ts",
      "src/002.ts",
      "src/003.ts",
      "src/004.ts",
      "src/005.ts",
    ]);
    await expect(isProjectFile(root, "src/000.ts")).resolves.toBe(false);
    await expect(isProjectFile(root, "src/001.ts")).resolves.toBe(true);
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

  it("removes stale generated skills without touching user-owned skills", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-"));
    await syncSkills(root, [
      { name: "old", client: "old/client", skills: [{ name: "old", content: "# Old" }] },
    ]);
    await syncSkills(root, []);
    await expect(readFile(path.join(root, ".skills/old/SKILL.md"), "utf8")).rejects.toThrow();

    const userSkill = path.join(root, ".skills/user/SKILL.md");
    await mkdir(path.dirname(userSkill), { recursive: true });
    await writeFile(userSkill, "# User", "utf8");
    await syncSkills(root, []);
    await expect(readFile(userSkill, "utf8")).resolves.toBe("# User");
  });
});
