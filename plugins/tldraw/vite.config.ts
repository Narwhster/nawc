import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: true,
    exports: true,
    entry: ["src/index.ts", "src/client.tsx", "src/refresh.ts"],
  },
  test: { environment: "node" },
});
