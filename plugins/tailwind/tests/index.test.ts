import { describe, expect, it } from "vitest";
import { tailwind } from "../src/index.ts";

describe("tailwind plugin", () => {
  it("registers the Tailwind Vite integration", () => {
    const plugin = tailwind();

    expect(plugin).toMatchObject({
      name: "tailwind",
      vite: expect.any(Function),
    });
    expect(plugin.vite?.()).toBeDefined();
  });
});
