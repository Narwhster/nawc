import { readFile } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { definePlugin } from "@nawc/plugin";
import type { Plugin } from "vite";

export function injectTailwindSource(code: string, id: string, baseDir: string) {
  const filename = id.split("?", 1)[0];
  if (!filename.endsWith(".css") || !code.match(/@import\s+["']tailwindcss["']/)) return;

  const relativeBaseDir = path.relative(path.dirname(filename), baseDir).split(path.sep).join("/");

  return {
    code: `@source ${JSON.stringify(relativeBaseDir || ".")};\n${code}`,
    map: null,
  };
}

function tailwindSources(baseDir: string): Plugin {
  return {
    name: "nawc-tailwind-sources",
    enforce: "pre",
    async load(id) {
      const filename = id.split("?", 1)[0];
      if (!path.isAbsolute(filename) || !filename.endsWith(".css")) return;

      const code = await readFile(filename, "utf8");
      return injectTailwindSource(code, filename, baseDir);
    },
  };
}

export function tailwind() {
  return definePlugin({
    name: "tailwind",
    vite: ({ baseDir }) => [tailwindSources(baseDir), ...tailwindcss()],
  });
}
