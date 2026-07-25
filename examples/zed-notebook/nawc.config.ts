import { defineConfig, nawcLight } from "@nawc/cli";
import { zed } from "@nawc/editor-zed";
import { core } from "@nawc/core";
import { nawcSkills } from "@nawc/nawc-skills";
import { codex } from "@nawc/provider-codex";
import { typescript } from "@nawc/syntax-typescript";
import { vitest } from "@nawc/syntax-vitest";

export default defineConfig({
  plugins: [core(), nawcSkills(), typescript(), vitest()],
  provider: codex(),
  editor: zed(),
  theme: nawcLight(),
  baseDir: "..",
});
