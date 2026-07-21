import { defineConfig, nawcDark, vscode } from "nawc";
import { core } from "@nawc/core";
import { nawcSkills } from "@nawc/nawc-skills";
import { codex } from "@nawc/provider-codex";
import { rust } from "@nawc/syntax-rust";

export default defineConfig({
  plugins: [core(), nawcSkills(), rust()],
  provider: codex(),
  editor: vscode(),
  theme: nawcDark(),
  baseDir: ".",
});
