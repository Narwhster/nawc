import { defineConfig, nawcDark, vscode } from "nawc";
import { core } from "@nawc/core";
import { codex } from "@nawc/provider-codex";
import { java } from "@nawc/syntax-java";
import { junit } from "@nawc/syntax-junit";

export default defineConfig({
  plugins: [core()],
  provider: codex(),
  syntax: [java(), junit()],
  editor: vscode(),
  theme: nawcDark(),
  baseDir: ".",
});
