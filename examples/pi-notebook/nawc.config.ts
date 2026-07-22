import { defineConfig, nawcDark } from "nawc";
import { vscode } from "@nawc/editor-vscode";
import { core } from "@nawc/core";
import { nawcSkills } from "@nawc/nawc-skills";
import { pi } from "@nawc/provider-pi";
import { typescript } from "@nawc/syntax-typescript";
import { vitest } from "@nawc/syntax-vitest";

export default defineConfig({
  plugins: [core(), nawcSkills(), typescript(), vitest()],
  provider: pi(),
  editor: vscode(),
  theme: nawcDark(),
  baseDir: "../..",
});
