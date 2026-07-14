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

  it("highlights known source and safely escapes unknown source", () => {
    expect(highlightSource("const value = 1", "ts")).toContain('class="hljs-keyword"');
    expect(highlightSource("<not-known>", "unknown")).toBe("&lt;not-known&gt;");
  });
});
