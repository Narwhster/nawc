// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { normalizeSelfClosingNodes, serializeHtml } from "./serialize";

describe("note HTML normalization", () => {
  it("expands self-closing registered nodes without changing void elements", () => {
    expect(
      normalizeSelfClosingNodes(
        '<react-interactive file="src/Demo.tsx"/><p>After</p><interactive /><br />',
        ["react-interactive", "interactive"],
      ),
    ).toBe(
      '<react-interactive file="src/Demo.tsx"></react-interactive><p>After</p><interactive ></interactive><br />',
    );
  });

  it("does not match names that only start with a registered node tag", () => {
    expect(normalizeSelfClosingNodes("<react-interactive-extra />", ["react-interactive"])).toBe(
      "<react-interactive-extra />",
    );
  });
});

describe("note serialization", () => {
  it("restores canonical interactive HTML from Tiptap attributes", () => {
    const source = `<script>let count = 0</script><button onclick="count++">0</button>`;
    const html = `<interactive data-nawc-node="interactive" data-nawc-source="${source.replaceAll('"', "&quot;")}"></interactive>`;
    expect(serializeHtml(html)).toBe(`<interactive>${source}</interactive>`);
  });

  it("preserves file-backed interactive references", () => {
    expect(
      serializeHtml(
        '<interactive data-nawc-node="interactive" data-nawc-source="" file="src/demo.html"></interactive>',
      ),
    ).toBe('<interactive file="src/demo.html"></interactive>');
  });

  it("preserves React interactive references", () => {
    expect(
      serializeHtml(
        '<react-interactive data-nawc-node="react-interactive" file="src/Demo.tsx"></react-interactive>',
      ),
    ).toBe('<react-interactive file="src/Demo.tsx"></react-interactive>');
  });

  it("keeps source references free of copied code", () => {
    expect(serializeHtml('<ref data-nawc-node="ref" file="src/foo.ts" syntax="ts"></ref>')).toBe(
      '<ref file="src/foo.ts" syntax="ts"></ref>',
    );
  });

  it("stores inline runnable source as escaped text instead of note HTML", () => {
    expect(
      serializeHtml(
        '<runnable data-nawc-node="runnable" data-nawc-source="&lt;b&gt;value&lt;/b&gt;" syntax="html"></runnable>',
      ),
    ).toBe('<runnable syntax="html">&lt;b&gt;value&lt;/b&gt;</runnable>');
  });
});
