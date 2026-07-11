import { describe, expect, it } from "vitest";
import { resolveVitest } from "../src/index.ts";

describe("Vitest syntax", () => {
  it("extracts an exact test", () => {
    const source = `describe("math", () => {\n  it("adds", () => expect(1 + 1).toBe(2))\n})`;
    const result = resolveVitest(source, { file: "math.test.ts", type: "it", name: "adds" });
    expect(result?.code).toBe('it("adds", () => expect(1 + 1).toBe(2))');
    expect(result?.startLine).toBe(2);
  });
});
