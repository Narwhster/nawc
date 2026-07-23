import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveTldrawFile,
  resolveTldrawScript,
  tldraw,
  tldrawPreviewHtml,
  tldrawSkill,
  writeTldrawSnapshot,
} from "../src/index.ts";
import { shouldRefreshTldraw } from "../src/refresh.ts";

describe("tldraw plugin", () => {
  it("registers the canvas, skill, references, and Vite integration", () => {
    expect(tldraw()).toMatchObject({
      name: "tldraw",
      client: "@nawc/tldraw/client",
      nodes: [{ name: "tldraw-canvas", tag: "tldraw-canvas" }],
      skills: [{ name: "tldraw", content: tldrawSkill }],
      references: expect.any(Function),
      vite: expect.any(Function),
    });
  });

  it("documents file-backed and script-driven canvases", () => {
    expect(tldrawSkill).toContain('<tldraw-canvas file="diagrams/system.tldr"');
    expect(tldrawSkill).toContain("default-export a function");
    expect(tldrawSkill).not.toContain('import { tldraw } from "@nawc/tldraw"');
    expect(tldrawSkill).not.toContain("## Workflow");
  });

  it("creates a missing snapshot below the base directory and writes atomically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nawc-tldraw-"));
    const file = await resolveTldrawFile(root, "diagrams/system.tldr");
    await writeTldrawSnapshot(file, { document: { store: {} } });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ document: { store: {} } });
  });

  it("rejects paths and symlinks outside the base directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nawc-tldraw-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "nawc-tldraw-outside-"));
    await writeFile(path.join(outside, "canvas.tldr"), "{}");
    await symlink(path.join(outside, "canvas.tldr"), path.join(root, "canvas.tldr"));
    await expect(resolveTldrawFile(root, "../canvas.tldr")).rejects.toThrow("escapes");
    await expect(resolveTldrawFile(root, "canvas.tldraw")).rejects.toThrow("Expected .tldr");
    await expect(resolveTldrawFile(root, "canvas.tldr")).rejects.toThrow("escapes");
  });

  it("resolves a TypeScript canvas script inside the base directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nawc-tldraw-script-"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "diagram.ts"), "export default () => {};");
    await expect(resolveTldrawScript(root, "src/diagram.ts")).resolves.toBe(
      await realpath(path.join(root, "src", "diagram.ts")),
    );
  });

  it("loads tldraw, restores snapshots, and runs an optional script", () => {
    const html = tldrawPreviewHtml({ document: { store: {} } }, "/project/diagram.ts");
    expect(html).toContain('from "virtual:nawc-tldraw-runtime"');
    expect(html).toContain("loadSnapshot(store, initial)");
    expect(html).toContain('const url = "/@fs//project/diagram.ts"');
    expect(html).toContain("await import(/* @vite-ignore */ url)");
    expect(html).toContain("nawc:tldraw-save");
  });

  it("extracts snapshot and script references", () => {
    expect(
      tldraw().references!({
        html: '<tldraw-canvas file="a.tldr" script="a.ts"></tldraw-canvas><tldraw-canvas file="a.tldr"></tldraw-canvas>',
      }),
    ).toEqual([{ path: "a.tldr" }, { path: "a.ts" }]);
  });

  it("ignores unrelated changes and the watcher echo from its own snapshot save", () => {
    const files = {
      snapshot: "examples/notebook/src/system.tldr",
      script: "examples/notebook/src/system.tldraw.ts",
    };
    expect(shouldRefreshTldraw({ event: "change", file: "other.ts" }, files, false)).toBe(false);
    expect(shouldRefreshTldraw({ event: "change", file: "system.tldr" }, files, true)).toBe(false);
    expect(shouldRefreshTldraw({ event: "change", file: "system.tldr" }, files, false)).toBe(true);
    expect(shouldRefreshTldraw({ event: "change", file: "system.tldraw.ts" }, files, true)).toBe(
      true,
    );
  });
});
