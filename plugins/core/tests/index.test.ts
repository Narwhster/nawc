import { describe, expect, it } from "vitest";
import { core } from "../src/index.ts";

describe("core plugin", () => {
  it("ships editor nodes without authoring skills", () => {
    expect(core()).not.toHaveProperty("skills");
  });
});
