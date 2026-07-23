import { core } from "@nawc/core";
import { opencode } from "@nawc/provider-opencode";
import { rust } from "@nawc/syntax-rust";
import { typescript } from "@nawc/syntax-typescript";
import { defineConfig, nawcDark } from "nawc";

export default defineConfig({
  baseDir: ".",
  plugins: [core(), rust(), typescript()],
  provider: opencode(),
  theme: nawcDark(),
});
