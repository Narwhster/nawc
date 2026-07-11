import { definePlugin } from "@nawc/plugin";

export const coreSkill = `# NAWC core nodes

NAWC notes are HTML files. Use these custom elements directly in note HTML.

- \`<interactive>...</interactive>\` contains a self-contained HTML prototype. It is rendered in a sandboxed iframe. Inline scripts and styles are allowed.
- \`<ref file="src/foo.ts" />\` shows a live file. Add \`syntax="ts" name="bar" type="function"\` to select a declaration.
- \`<runnable file="src/example.ts" syntax="ts" />\` shows live source and lets the reader run it. Vitest blocks may use a test name and type.

Paths are relative to the configured base directory. Never copy source text into ref or runnable elements.`;

export function core() {
  return definePlugin({
    name: "core",
    client: "@nawc/core/client",
    nodes: [
      { name: "interactive", tag: "interactive", description: "Sandboxed HTML prototype" },
      { name: "ref", tag: "ref", description: "Live source reference" },
      { name: "runnable", tag: "runnable", description: "Runnable source reference" },
    ],
    skills: [{ name: "core", content: coreSkill }],
  });
}
