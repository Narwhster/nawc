import { describe, expect, it } from "vitest";
import { core } from "../src/index.ts";

describe("core plugin", () => {
  it("ships editor nodes without authoring skills", () => {
    expect(core()).not.toHaveProperty("skills");
  });

  it("includes a markdown syntax", () => {
    const plugin = core();
    expect(plugin.syntax).toHaveLength(2);
    const md = plugin.syntax![0];
    expect(md.name).toBe("markdown");
    expect(md.aliases).toEqual(["md"]);
    expect(md.highlight).toBe("markdown");
    expect(md.extension).toBe("md");
  });

  it("includes a bash syntax", () => {
    const plugin = core();
    const bash = plugin.syntax![1];
    expect(bash.name).toBe("bash");
    expect(bash.aliases).toEqual(["sh", "shell", "zsh"]);
    expect(bash.highlight).toBe("bash");
    expect(bash.extension).toBe("sh");
  });

  it("resolves full source for markdown and bash", () => {
    const plugin = core();
    const source = "# Hello\n\nWorld";
    for (const syntax of plugin.syntax!) {
      const result = syntax.resolve(source, { file: "test" });
      expect(result).toEqual({ file: "test", code: source, startLine: 1, endLine: 3 });
    }
  });

  it("extracts file references from <code>, <runnable>, and <interactive>", () => {
    const plugin = core();
    expect(plugin.references).toBeDefined();
    const html = `
      <code file="src/a.ts"></code>
      <runnable file="src/b.ts" syntax="vitest"></runnable>
      <interactive file="src/c.html"></interactive>
      <code file="src/a.ts"></code>
    `;
    expect(plugin.references!({ html })).toEqual([
      { path: "src/a.ts" },
      { path: "src/b.ts" },
      { path: "src/c.html" },
    ]);
  });

  it("ignores file-less and non-reference elements", () => {
    const plugin = core();
    const html = '<p>Hello <a href="https://example.com">link</a></p>';
    expect(plugin.references!({ html })).toEqual([]);
  });
});
