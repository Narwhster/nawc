import { defineConfig, nawcDark, vscode } from "nawc";
import { core } from "@nawc/core";
import { nawcSkills } from "@nawc/nawc-skills";
import { opencode } from "@nawc/provider-opencode";
import { typescript } from "@nawc/syntax-typescript";
import { vitest } from "@nawc/syntax-vitest";

export default defineConfig({
  plugins: [core(), nawcSkills(), typescript(), vitest()],
  provider: opencode(),
  editor: vscode(),
  theme: nawcDark(),
  baseDir: "..",
});
