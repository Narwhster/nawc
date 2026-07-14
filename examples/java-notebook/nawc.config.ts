import { defineConfig, nawcDark, vscode } from "nawc";
import { core } from "@nawc/core";
import { nawcSkills } from "@nawc/nawc-skills";
import { codex } from "@nawc/provider-codex";
import { java } from "@nawc/syntax-java";
import { junit } from "@nawc/syntax-junit";

export default defineConfig({
  plugins: [core(), nawcSkills(), java(), junit()],
  provider: codex(),
  editor: vscode(),
  theme: nawcDark(),
  baseDir: ".",
});
