import type { NawcSyntax } from "@nawc/config";

export const json = (): NawcSyntax => ({
  name: "json",
  aliases: ["jsonc"],
  resolve(source, selection) {
    return {
      ...selection,
      code: source,
      startLine: 1,
      endLine: source.split("\n").length,
    };
  },
  run: ({ file, cwd }) => ({
    command: [process.execPath, "tool.mjs", file],
    cwd,
  }),
});
