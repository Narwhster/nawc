import { describe, expect, it } from "vitest";
import { core } from "../src/index.ts";

describe("core plugin", () => {
  it("ships editor nodes without authoring skills", () => {
    expect(core()).not.toHaveProperty("skills");
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
