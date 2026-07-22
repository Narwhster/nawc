import { describe, expect, it } from "vitest";
import { errorFromPi, estimatePi, leibniz } from "./pi-utils.js";

describe("leibniz", () => {
  it("returns 4 for the first term (i=0)", () => {
    expect(leibniz(1)).toBe(4);
  });

  it("returns 0 for zero iterations", () => {
    expect(leibniz(0)).toBe(0);
  });

  it("converges toward pi as iterations increase", () => {
    const estimate = leibniz(10000);
    expect(errorFromPi(estimate)).toBeLessThan(0.01);
  });
});

describe("estimatePi", () => {
  it("matches leibniz for the same iteration count", () => {
    expect(estimatePi(1000)).toBe(leibniz(1000));
  });
});

describe("errorFromPi", () => {
  it("is zero when the estimate equals pi", () => {
    expect(errorFromPi(Math.PI)).toBe(0);
  });

  it("is positive when the estimate differs from pi", () => {
    expect(errorFromPi(3)).toBeGreaterThan(0);
  });
});
