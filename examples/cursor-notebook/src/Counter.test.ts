import { describe, expect, it } from "vitest";
import { countLabel } from "./counter-utils.js";

describe("countLabel", () => {
  it("uses the singular label for one item", () => {
    expect(countLabel(1)).toBe("1 item");
  });

  it("uses the plural label for every other count", () => {
    expect(countLabel(0)).toBe("0 items");
    expect(countLabel(2)).toBe("2 items");
  });
});
