import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: true,
    exports: {
      bin: {
        "nawc-site": "./src/cli.ts",
      },
    },
    entry: ["src/index.ts", "src/browser.ts", "src/cli.ts"],
  },
  test: {},
});
