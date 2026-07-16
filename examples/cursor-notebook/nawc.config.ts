import { defineConfig, nawcDark, vscode } from "nawc";
import { core } from "@nawc/core";
import { nawcSkills } from "@nawc/nawc-skills";
import { cursor } from "@nawc/provider-cursor";
import { react } from "@nawc/react";
import { tailwind } from "@nawc/tailwind";
import { typescript } from "@nawc/syntax-typescript";
import { vitest } from "@nawc/syntax-vitest";

export default defineConfig({
  plugins: [core(), nawcSkills(), react(), tailwind(), typescript(), vitest()],
  provider: cursor(),
  editor: vscode(),
  theme: nawcDark(),
  baseDir: "../..",
});
