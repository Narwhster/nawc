import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { definePlugin, type NawcFileReference } from "@nawc/plugin";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { Plugin } from "vite";

const PREVIEW_PATH = "/@nawc/tldraw";
const RUNTIME_ID = "virtual:nawc-tldraw-runtime";

export const tldrawSkill = `---
name: tldraw
description: Use when creating, editing, or reasoning about file-backed tldraw canvases in NAWC notes.
---

# tldraw canvases

Add a file-backed canvas to note HTML:

\`\`\`html
<tldraw-canvas file="diagrams/system.tldr"></tldraw-canvas>
\`\`\`

The \`file\` path is relative to the configured NAWC \`baseDir\` and must end in \`.tldr\`. The canvas saves a tldraw store snapshot to that file and reloads when project files change.

## Agent-authored canvases

Prefer a persistent TypeScript script when an agent must create or maintain canvas content:

\`\`\`html
<tldraw-canvas file="diagrams/system.tldr" script="diagrams/system.tldraw.ts"></tldraw-canvas>
\`\`\`

The script must default-export a function that receives the mounted tldraw \`Editor\`. It may return a cleanup function.

\`\`\`ts
import { createShapeId, type Editor } from "tldraw";

export default function buildSystemDiagram(editor: Editor) {
  const id = createShapeId("api");
  if (!editor.getShape(id)) {
    editor.createShape({
      id,
      type: "geo",
      x: 120,
      y: 100,
      props: { geo: "rectangle", w: 240, h: 96, text: "API" },
    });
  }
  editor.zoomToFit();
}
\`\`\`

The script path is relative to \`baseDir\` and may use \`.js\`, \`.jsx\`, \`.ts\`, or \`.tsx\`. It reruns when its module reloads. Use stable shape IDs when a script needs to find the same shapes again.

Consult current official tldraw documentation at https://tldraw.dev/llms.txt when using Editor APIs beyond familiar shape creation, updates, bindings, assets, events, or exports.
`;

function safeRelativePath(baseDir: string, file: string, extensions: readonly string[]): string {
  if (!extensions.some((extension) => file.endsWith(extension)))
    throw new Error(`Expected ${extensions.join(" or ")} file`);
  const root = path.resolve(baseDir);
  const target = path.resolve(root, file);
  if (target === root || !target.startsWith(`${root}${path.sep}`))
    throw new Error("tldraw file escapes the configured directory");
  return target;
}

export async function resolveTldrawFile(baseDir: string, file: string): Promise<string> {
  const target = safeRelativePath(baseDir, file, [".tldr"]);
  const root = await realpath(baseDir);
  if (existsSync(target)) {
    const resolved = await realpath(target);
    if (!resolved.startsWith(`${root}${path.sep}`))
      throw new Error("tldraw file escapes the configured directory");
    return resolved;
  }
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const resolvedParent = await realpath(parent);
  if (resolvedParent !== root && !resolvedParent.startsWith(`${root}${path.sep}`))
    throw new Error("tldraw file escapes the configured directory");
  return target;
}

export async function resolveTldrawScript(baseDir: string, file: string): Promise<string> {
  const target = safeRelativePath(baseDir, file, [".js", ".jsx", ".ts", ".tsx"]);
  const root = await realpath(baseDir);
  const resolved = await realpath(target);
  if (!resolved.startsWith(`${root}${path.sep}`))
    throw new Error("tldraw script escapes the configured directory");
  return resolved;
}

export async function writeTldrawSnapshot(file: string, snapshot: unknown): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temporary, file);
}

export function tldrawPreviewHtml(
  snapshot: unknown,
  script?: string,
  runtime = RUNTIME_ID,
): string {
  const initial = JSON.stringify(snapshot).replaceAll("<", "\\u003c");
  const scriptUrl = script ? JSON.stringify(`/@fs/${script}`) : "null";
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}.error{padding:16px;color:#b42318;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap}</style></head><body><div id="root"></div><script type="module">
import React from "react";
import { createRoot } from "react-dom/client";
import { createTLStore, defaultShapeUtils, getSnapshot, loadSnapshot, Tldraw } from ${JSON.stringify(runtime)};
const initial = ${initial};
const store = createTLStore({ shapeUtils: defaultShapeUtils });
if (initial) loadSnapshot(store, initial);
let mounted = false;
let timer;
const save = () => { if (!mounted) return; clearTimeout(timer); timer = setTimeout(() => parent.postMessage({ type: "nawc:tldraw-save", snapshot: getSnapshot(store) }, "*"), 250); };
store.listen(save, { scope: "document" });
function App() { return React.createElement(Tldraw, { store, onMount: async editor => { mounted = true; const url = ${scriptUrl}; if (url) { const module = await import(/* @vite-ignore */ url); if (typeof module.default !== "function") throw new Error("The tldraw script must default-export a function"); await module.default(editor); } } }); }
try { createRoot(document.querySelector("#root")).render(React.createElement(App)); } catch (cause) { document.querySelector("#root").className="error"; document.querySelector("#root").textContent=cause instanceof Error ? cause.stack ?? cause.message : String(cause); }
</script></body></html>`;
}

type Element = DefaultTreeAdapterMap["element"];
type Child = DefaultTreeAdapterMap["node"];
function isElement(node: Child): node is Element {
  return "tagName" in node;
}
function references({ html }: { readonly html: string }): readonly NawcFileReference[] {
  const found = new Set<string>();
  const visit = (node: Child): void => {
    if (isElement(node) && node.nodeName === "tldraw-canvas")
      for (const name of ["file", "script"]) {
        const value = node.attrs.find((attribute) => attribute.name === name)?.value.trim();
        if (value) found.add(value);
      }
    for (const child of "childNodes" in node ? node.childNodes : []) visit(child);
  };
  visit(parseFragment(html));
  return [...found].sort().map((file) => ({ path: file }));
}

function vitePlugin(baseDir: string): Plugin {
  const pluginDir = path.dirname(fileURLToPath(import.meta.url));
  const resolvedRuntimeId = path.join(pluginDir, ".nawc-tldraw-runtime.js");
  const tldrawEntry = fileURLToPath(import.meta.resolve("tldraw", import.meta.url));
  const tldrawCssEntry = path.join(path.dirname(tldrawEntry), "..", "tldraw.css");
  return {
    name: "nawc-tldraw",
    config() {
      return {
        optimizeDeps: {
          include: ["tldraw"],
        },
        resolve: {
          alias: [
            { find: /^tldraw\/tldraw\.css$/, replacement: tldrawCssEntry },
            { find: /^tldraw$/, replacement: tldrawEntry },
          ],
        },
      };
    },
    resolveId(id) {
      if (id === RUNTIME_ID) return resolvedRuntimeId;
    },
    load(id) {
      if (id === resolvedRuntimeId) return 'import "tldraw/tldraw.css"; export * from "tldraw";';
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== PREVIEW_PATH) return next();
        try {
          const file = await resolveTldrawFile(baseDir, url.searchParams.get("file") ?? "");
          if (request.method === "POST") {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            const snapshot = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            await writeTldrawSnapshot(file, snapshot);
            response.statusCode = 204;
            response.end();
            return;
          }
          const snapshot = existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : null;
          const scriptName = url.searchParams.get("script");
          const script = scriptName ? await resolveTldrawScript(baseDir, scriptName) : undefined;
          const html = await server.transformIndexHtml(
            PREVIEW_PATH,
            tldrawPreviewHtml(snapshot, script),
          );
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(html);
        } catch (error) {
          response.statusCode = 400;
          response.setHeader("content-type", "text/plain; charset=utf-8");
          response.end(error instanceof Error ? error.message : String(error));
        }
      });
    },
  };
}

export function tldraw() {
  return definePlugin({
    name: "tldraw",
    client: "@nawc/tldraw/client",
    nodes: [
      { name: "tldraw-canvas", tag: "tldraw-canvas", description: "File-backed tldraw canvas" },
    ],
    skills: [{ name: "tldraw", content: tldrawSkill }],
    references,
    vite: ({ baseDir }) => vitePlugin(baseDir),
  });
}
