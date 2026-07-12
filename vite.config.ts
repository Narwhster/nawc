import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "**/.notebook/**"],
  },
});
