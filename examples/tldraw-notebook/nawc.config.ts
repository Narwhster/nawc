import { defineConfig, nawcDark } from "@nawc/cli";
import { vscode } from "@nawc/editor-vscode";
import { core } from "@nawc/core";
import { nawcSkills } from "@nawc/nawc-skills";
import { codex } from "@nawc/provider-codex";
import { tldraw } from "@nawc/tldraw";

export default defineConfig({
  plugins: [core(), nawcSkills(), tldraw()],
  provider: codex(),
  editor: vscode(),
  theme: nawcDark(),
  baseDir: "../..",
});
