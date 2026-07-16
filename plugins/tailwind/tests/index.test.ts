import { describe, expect, it } from "vitest";
import { injectTailwindSource, tailwind } from "../src/index.ts";

describe("tailwind plugin", () => {
  it("registers the Tailwind Vite integration", () => {
    const plugin = tailwind();

    expect(plugin).toMatchObject({
      name: "tailwind",
      vite: expect.any(Function),
    });

    const vitePlugins = plugin.vite?.({ baseDir: "/workspace" });
    expect(vitePlugins).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "nawc-tailwind-sources" })]),
    );

    expect(
      injectTailwindSource('@import "tailwindcss";', "/workspace/src/styles.css", "/workspace"),
    ).toMatchObject({
      code: '@source "..";\n@import "tailwindcss";',
      map: null,
    });
  });
});
