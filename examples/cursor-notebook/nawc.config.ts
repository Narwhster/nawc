import { defineConfig, nawcDark } from "nawc";
import { cursor } from "@nawc/editor-cursor";
import { core } from "@nawc/core";
import { nawcSkills } from "@nawc/nawc-skills";
import { cursor as cursorProvider } from "@nawc/provider-cursor";
import { react } from "@nawc/react";
import { tailwind } from "@nawc/tailwind";
import { typescript } from "@nawc/syntax-typescript";
import { vitest } from "@nawc/syntax-vitest";

export default defineConfig({
  plugins: [core(), nawcSkills(), react(), tailwind(), typescript(), vitest()],
  provider: cursorProvider(),
  editor: cursor(),
  theme: nawcDark(),
  baseDir: "../..",
});
