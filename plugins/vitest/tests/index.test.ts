import { describe, expect, it } from "vitest";
import { resolveVitest, vitestRunCommand } from "../src/index.ts";

describe("Vitest syntax", () => {
  it("extracts an exact test", () => {
    const source = `describe("math", () => {\n  it("adds", () => expect(1 + 1).toBe(2))\n})`;
    const result = resolveVitest(source, { file: "math.test.ts", type: "it", name: "adds" });
    expect(result?.code).toBe('it("adds", () => expect(1 + 1).toBe(2))');
    expect(result?.startLine).toBe(2);
  });

  it("loads the notebook config for notebook ticket tests", () => {
    const result = vitestRunCommand(
      ".notebook/src/tickets/open/extensibility/example.test.ts",
      "/repo",
      "fails",
    );
    expect(result.command).toContain("--config");
    expect(result.command).toContain("/repo/.notebook/vite.config.ts");
    expect(result.command).toContain("src/tickets/open/extensibility/example.test.ts");
  });
});
