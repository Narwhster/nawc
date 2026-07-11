// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { serializeHtml } from "./serialize";

describe("note serialization", () => {
  it("restores canonical interactive HTML from Tiptap attributes", () => {
    const source = `<script>let count = 0</script><button onclick="count++">0</button>`;
    const html = `<interactive data-nawc-node="interactive" data-nawc-source="${source.replaceAll('"', "&quot;")}"></interactive>`;
    expect(serializeHtml(html)).toBe(`<interactive>${source}</interactive>`);
  });

  it("keeps source references free of copied code", () => {
    expect(serializeHtml('<ref data-nawc-node="ref" file="src/foo.ts" syntax="ts"></ref>')).toBe(
      '<ref file="src/foo.ts" syntax="ts"></ref>',
    );
  });
});
