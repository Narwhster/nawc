import { defineConfig, nawcDark, vscode } from "nawc";
import { core } from "@nawc/core";
import { codex } from "@nawc/provider-codex";
import { typescript } from "@nawc/syntax-typescript";
import { vitest } from "@nawc/syntax-vitest";

export default defineConfig({
  plugins: [core()],
  provider: codex(),
  syntax: [typescript(), vitest()],
  editor: vscode(),
  theme: nawcDark(),
  baseDir: "..",
});
