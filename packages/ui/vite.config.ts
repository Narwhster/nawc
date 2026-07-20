import { defineConfig } from "vite-plus";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@nawcui": path.resolve(import.meta.dirname, "src") } },
  plugins: [
    tailwindcss(),
    {
      name: "nawc-empty-plugin-fallback",
      apply: "build",
      resolveId(id) {
        return id === "virtual:nawc-plugins" ? "\0virtual:nawc-plugins" : undefined;
      },
      load(id) {
        return id === "\0virtual:nawc-plugins" ? "export default [];" : undefined;
      },
    },
  ],
  test: { environment: "jsdom" },
});
