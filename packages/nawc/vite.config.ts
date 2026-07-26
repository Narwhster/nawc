import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: {
    dts: true,
    exports: {
      bin: {
        nawc: "./src/nawc.ts",
      },
    },
    entry: ["src/index.ts", "src/nawc.ts"],
  },
  test: {},
});
