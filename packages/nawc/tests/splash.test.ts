import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { core } from "@nawc/core";
import { react } from "@nawc/react";
import {
  computeSplash,
  extractFileReferences,
  extractWikiLinks,
  getModifiedProjectFiles,
  notePathFor,
} from "../src/splash.ts";

const execFileAsync = promisify(execFile);

async function initRepo(root: string) {
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Test"]);
  await execFileAsync("git", ["-C", root, "config", "commit.gpgsign", "false"]);
}

async function writeNote(root: string, note: string, body: string) {
  const file = path.join(root, note);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body, "utf8");
}

describe("notePathFor", () => {
  it("appends the .html suffix when missing", () => {
    expect(notePathFor("intro")).toBe("intro.html");
  });

  it("keeps the .html suffix when present", () => {
    expect(notePathFor("docs/intro.html")).toBe("docs/intro.html");
  });
});

describe("extractWikiLinks", () => {
  it("collects data-wiki-link targets and appends .html", () => {
    const html = `
      <p>
        <a data-wiki-link="Architecture" href="#Architecture">[[Architecture]]</a>
      </p>
    `;
    expect(extractWikiLinks(html)).toEqual(["Architecture.html"]);
  });

  it("falls back to [[...]] text when no data-wiki-link attribute exists", () => {
    const html = '<p><a href="#foo">[[Other Note]]</a></p>';
    expect(extractWikiLinks(html)).toEqual(["Other Note.html"]);
  });

  it("deduplicates and sorts", () => {
    const html = `
      <a data-wiki-link="beta"></a>
      <a data-wiki-link="alpha"></a>
      <a data-wiki-link="beta"></a>
    `;
    expect(extractWikiLinks(html)).toEqual(["alpha.html", "beta.html"]);
  });

  it("ignores links without a wiki-link signal", () => {
    const html = '<a href="https://example.com">Example</a>';
    expect(extractWikiLinks(html)).toEqual([]);
  });
});

describe("extractFileReferences", () => {
  it("merges references reported by every plugin", () => {
    const html = `
      <ref file="src/a.ts"></ref>
      <runnable file="src/b.ts"></runnable>
      <interactive file="src/c.html"></interactive>
      <react-interactive file="src/d.tsx"></react-interactive>
    `;
    const references = extractFileReferences(html, [core(), react()]);
    expect(references).toEqual(["src/a.ts", "src/b.ts", "src/c.html", "src/d.tsx"]);
  });

  it("ignores plugins without a references hook", () => {
    const html = '<ref file="src/a.ts"></ref>';
    const references = extractFileReferences(html, [
      { name: "noop" },
      { name: "only-refs", references: () => [{ path: "src/x.ts" }] },
    ]);
    expect(references).toEqual(["src/x.ts"]);
  });
});

describe("getModifiedProjectFiles", () => {
  it("returns modified, added, and untracked paths and excludes ignored entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-modified-"));
    await initRepo(root);
    await writeFile(path.join(root, "tracked.ts"), "a", "utf8");
    await writeFile(path.join(root, ".gitignore"), "ignored.ts\n", "utf8");
    await execFileAsync("git", ["-C", root, "add", "."]);
    await execFileAsync("git", ["-C", root, "commit", "-m", "init"]);
    await writeFile(path.join(root, "tracked.ts"), "b", "utf8");
    await writeFile(path.join(root, "new.ts"), "c", "utf8");
    await writeFile(path.join(root, "ignored.ts"), "x", "utf8");
    const files = await getModifiedProjectFiles(root);
    expect([...files].sort()).toEqual(["new.ts", "tracked.ts"]);
  });

  it("returns the new path for renames", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nawc-rename-"));
    await initRepo(root);
    await writeFile(path.join(root, "old.ts"), "a", "utf8");
    await execFileAsync("git", ["-C", root, "add", "."]);
    await execFileAsync("git", ["-C", root, "commit", "-m", "init"]);
    await execFileAsync("git", ["-C", root, "mv", "old.ts", "new.ts"]);
    const files = await getModifiedProjectFiles(root);
    expect([...files]).toEqual(["new.ts"]);
  });
});

describe("computeSplash", () => {
  it("lists notes that reference modified files and expands wiki-link chains to the requested depth", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "nawc-splash-"));
    const baseDir = path.join(projectDir, "base");
    const srcDir = path.join(projectDir, "src");
    await initRepo(baseDir);
    await mkdir(baseDir, { recursive: true });
    await writeFile(path.join(baseDir, "edited.ts"), "a", "utf8");
    await execFileAsync("git", ["-C", baseDir, "add", "."]);
    await execFileAsync("git", ["-C", baseDir, "commit", "-m", "init"]);
    await writeFile(path.join(baseDir, "edited.ts"), "b", "utf8");
    await writeNote(
      srcDir,
      "A.html",
      `<ref file="edited.ts"></ref>
<p>
  <a data-wiki-link="B" href="#B">[[B]]</a>,
  <a data-wiki-link="C" href="#C">[[C]]</a>,
  <a data-wiki-link="D" href="#D">[[D]]</a>
</p>`,
    );
    await writeNote(srcDir, "B.html", "<p>B</p>");
    await writeNote(srcDir, "C.html", "<p>C</p>");
    await writeNote(srcDir, "D.html", "<p>D</p>");
    await writeNote(srcDir, "Quiet.html", "<p>No references</p>");
    const result = await computeSplash({
      srcDir,
      baseDir,
      plugins: [core()],
      depth: 1,
    });
    expect(result.zone).toEqual(["A.html"]);
    expect(result.modifiedFiles).toEqual(["edited.ts"]);
    expect(result.layers).toEqual([
      {
        depth: 1,
        links: [{ source: "A.html", targets: ["B.html", "C.html", "D.html"] }],
      },
    ]);
  });

  it("stops when there are no further wiki-link targets", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "nawc-splash-empty-"));
    const baseDir = path.join(projectDir, "base");
    const srcDir = path.join(projectDir, "src");
    await initRepo(baseDir);
    await mkdir(baseDir, { recursive: true });
    await writeFile(path.join(baseDir, "edited.ts"), "a", "utf8");
    await execFileAsync("git", ["-C", baseDir, "add", "."]);
    await execFileAsync("git", ["-C", baseDir, "commit", "-m", "init"]);
    await writeFile(path.join(baseDir, "edited.ts"), "b", "utf8");
    await writeNote(srcDir, "Isolated.html", '<ref file="edited.ts"></ref>');
    const result = await computeSplash({
      srcDir,
      baseDir,
      plugins: [core()],
      depth: 3,
    });
    expect(result.zone).toEqual(["Isolated.html"]);
    expect(result.layers).toEqual([]);
  });

  it("respects plugin-extracted references like <react-interactive>", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "nawc-splash-react-"));
    const baseDir = path.join(projectDir, "base");
    const srcDir = path.join(projectDir, "src");
    await initRepo(baseDir);
    await mkdir(baseDir, { recursive: true });
    await writeFile(path.join(baseDir, "Counter.tsx"), "export default () => null;", "utf8");
    await execFileAsync("git", ["-C", baseDir, "add", "."]);
    await execFileAsync("git", ["-C", baseDir, "commit", "-m", "init"]);
    await writeFile(path.join(baseDir, "Counter.tsx"), "export default () => 1;", "utf8");
    await writeNote(
      srcDir,
      "Welcome.html",
      '<react-interactive file="Counter.tsx"></react-interactive>',
    );
    const result = await computeSplash({
      srcDir,
      baseDir,
      plugins: [core(), react()],
      depth: 0,
    });
    expect(result.zone).toEqual(["Welcome.html"]);
  });
});
