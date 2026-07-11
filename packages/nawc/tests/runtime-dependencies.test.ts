import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const packageRequire = createRequire(new URL("../package.json", import.meta.url));

describe("packaged runtime dependencies", () => {
  it("resolves and loads the native terminal dependency from the nawc package", () => {
    expect(packageRequire.resolve("node-pty")).toContain("node-pty");
    expect(packageRequire("node-pty")).toHaveProperty("spawn");
  });
});
