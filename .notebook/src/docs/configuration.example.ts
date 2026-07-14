import { defineConfig, nawcDark, vscode, type NawcTheme } from "nawc";
import { core } from "@nawc/core";
import { nawcSkills } from "@nawc/nawc-skills";
import { codex } from "@nawc/provider-codex";
import { typescript } from "@nawc/syntax-typescript";
import { vitest } from "@nawc/syntax-vitest";

const base = nawcDark();

export const ocean: NawcTheme = {
  ...base,
  name: "ocean",
  variables: { ...base.variables, "--primary": "oklch(0.75 0.14 220)" },
};

export default defineConfig({
  plugins: [core(), nawcSkills(), typescript(), vitest()],
  provider: codex({ sandbox: "read-only" }),
  editor: vscode(),
  theme: ocean,
  baseDir: "..",
  port: 6292,
});
