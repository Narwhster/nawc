import { describe, expect, it } from "vitest";
import { highlightSource, sourceLanguage } from "../src/source-highlighting.js";

describe("source highlighting", () => {
  it("maps syntax names and file extensions to highlight.js languages", () => {
    expect(sourceLanguage("ts")).toBe("typescript");
    expect(sourceLanguage("vitest")).toBe("typescript");
    expect(sourceLanguage("java")).toBe("java");
    expect(sourceLanguage(undefined, "src/widget.html")).toBe("xml");
    expect(sourceLanguage(undefined, "src/App.java")).toBe("java");
  });

  it("uses configured canonical names and aliases as the source of truth", () => {
    const syntaxes = [{ name: "typed-js", aliases: ["diagram"], highlight: "typescript" }];
    expect(sourceLanguage("typed-js", undefined, syntaxes)).toBe("typescript");
    expect(sourceLanguage("diagram", undefined, syntaxes)).toBe("typescript");
    expect(highlightSource("const edge = 1", "diagram", undefined, syntaxes)).toContain(
      'class="hljs-keyword"',
    );
  });

  it("highlights known source and safely escapes unknown source", () => {
    expect(highlightSource("const value = 1", "ts")).toContain('class="hljs-keyword"');
    expect(highlightSource("<not-known>", "unknown")).toBe("&lt;not-known&gt;");
  });
});
