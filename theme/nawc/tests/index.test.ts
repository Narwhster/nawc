import { describe, expect, it } from "vitest";
import { nawcDark, nawcLight } from "../src/index.ts";
import type { NawcTheme } from "@nawc/config";

describe("themes", () => {
  it("nawcDark returns a dark theme", () => {
    expect(nawcDark()).toMatchObject({ name: "nawc-dark", appearance: "dark" });
  });

  it("nawcLight returns a light theme", () => {
    expect(nawcLight()).toMatchObject({ name: "nawc-light", appearance: "light" });
  });

  it("supports user-defined themes", () => {
    const custom = {
      name: "company",
      appearance: "light",
      variables: { "--background": "white", "--foreground": "black" },
    } satisfies NawcTheme;
    expect(custom.name).toBe("company");
  });
});
