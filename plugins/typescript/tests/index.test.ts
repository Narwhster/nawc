import { describe, expect, it } from "vitest";
import { resolveTypescript } from "../src/index.ts";

const source = `export type User = { name: string }\n\nexport function greet(user: User) {\n  return \`Hello \${user.name}\`\n}\n`;

describe("TypeScript syntax", () => {
  it("extracts a named declaration with line information", () => {
    const result = resolveTypescript(source, { file: "user.ts", type: "function", name: "greet" });
    expect(result?.code).toContain("function greet");
    expect(result?.startLine).toBe(3);
  });

  it("returns the whole file without a selector", () => {
    expect(resolveTypescript(source, { file: "user.ts" })?.code).toBe(source);
  });
});
