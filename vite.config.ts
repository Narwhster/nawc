import { defineConfig } from "vite-plus";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@nawcui": path.resolve(import.meta.dirname, "packages/ui/src") } },
  staged: {
    "*": "vp check --fix",
  },
  fmt: { ignorePatterns: ["**/.notebook/**"] },
  lint: {
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "**/.notebook/**"],
  },
});
