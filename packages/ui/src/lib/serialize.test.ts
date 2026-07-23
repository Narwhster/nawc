// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  normalizeCodeBlocks,
  normalizeNoteContent,
  normalizeSelfClosingNodes,
  serializeHtml,
} from "./serialize";

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

describe("code block normalization", () => {
  it("marks top-level code elements as code blocks", () => {
    expect(normalizeCodeBlocks('<code file="src/foo.ts"></code><p>After</p>')).toBe(
      '<code file="src/foo.ts" data-nawc-node="code"></code><p>After</p>',
    );
  });

  it("marks bare top-level code elements as inline-source code blocks", () => {
    expect(normalizeCodeBlocks('<code syntax="ts">const x = 1;</code>')).toBe(
      '<code syntax="ts" data-nawc-node="code">const x = 1;</code>',
    );
  });

  it("leaves inline code marks and pre blocks untouched", () => {
    const html = "<p>run <code>npm test</code> now</p><pre><code>block</code></pre>";
    expect(normalizeCodeBlocks(html)).toBe(html);
  });

  it("leaves already-marked code blocks untouched", () => {
    const html = '<code data-nawc-node="code" file="src/foo.ts"></code>';
    expect(normalizeCodeBlocks(html)).toBe(html);
  });

  it("expands self-closing code blocks before marking them", () => {
    expect(normalizeNoteContent('<code file="src/foo.ts"/><p>After</p>', ["code"])).toBe(
      '<code file="src/foo.ts" data-nawc-node="code"></code><p>After</p>',
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

  it("keeps file-backed code blocks free of copied code", () => {
    expect(serializeHtml('<code data-nawc-node="code" file="src/foo.ts" syntax="ts"></code>')).toBe(
      '<code file="src/foo.ts" syntax="ts"></code>',
    );
  });

  it("stores inline code source as escaped text instead of note HTML", () => {
    expect(
      serializeHtml(
        '<code data-nawc-node="code" data-nawc-source="&lt;b&gt;value&lt;/b&gt;" syntax="html"></code>',
      ),
    ).toBe('<code syntax="html">&lt;b&gt;value&lt;/b&gt;</code>');
  });

  it("stores inline runnable source as escaped text instead of note HTML", () => {
    expect(
      serializeHtml(
        '<runnable data-nawc-node="runnable" data-nawc-source="&lt;b&gt;value&lt;/b&gt;" syntax="html"></runnable>',
      ),
    ).toBe('<runnable syntax="html">&lt;b&gt;value&lt;/b&gt;</runnable>');
  });
});
