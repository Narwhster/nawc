import { defineConfig } from "vite-plus";
import path from "node:path";

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../packages/ui/src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
  },
});
