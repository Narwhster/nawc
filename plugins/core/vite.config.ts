import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: { dts: true, exports: true, entry: ["src/index.ts", "src/client.tsx"] },
  test: { environment: "jsdom" },
});
