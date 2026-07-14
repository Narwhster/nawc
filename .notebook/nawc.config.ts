import { defineConfig, nawcDark, vscode } from "nawc";
import { core } from "@nawc/core";
import { opencode } from "@nawc/provider-opencode";
import { typescript } from "@nawc/syntax-typescript";
import { vitest } from "@nawc/syntax-vitest";

export default defineConfig({
  plugins: [core()],
  provider: opencode(),
  syntax: [typescript(), vitest()],
  editor: vscode(),
  theme: nawcDark(),
  baseDir: "..",
});
