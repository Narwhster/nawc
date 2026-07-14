import { realpath } from "node:fs/promises";
import path from "node:path";
import { definePlugin } from "@nawc/plugin";
import type { Plugin } from "vite";

const PREVIEW_PATH = "/@nawc/react-interactive";

export const reactSkill = `---
name: react
description: Use when configuring or writing React interactive components in NAWC notes.
---

# React interactives

Add the React plugin to the NAWC config:

\`\`\`ts
import { react } from "@nawc/react";

export default defineConfig({
  plugins: [core(), react()],
  // ...
});
\`\`\`

Use a file-backed React interactive in note HTML:

\`\`\`html
<react-interactive file="path/to/component.tsx" />
\`\`\`

The \`file\` path is required and is relative to the configured NAWC \`baseDir\`. Files must use a \`.jsx\` or \`.tsx\` extension and default-export a React component.

\`\`\`tsx
export default function Example() {
  return <button type="button">Example</button>;
}
\`\`\`

Components may use React state and import other modules, assets, and CSS through Vite. They receive no props and run in an isolated iframe. Keep each component self-contained and focused on one UI or interaction.

Do not put inline content inside \`<react-interactive>\`. Use a regular \`<interactive>\` block for inline HTML prototypes.
`;

export async function resolveReactComponent(baseDir: string, file: string): Promise<string> {
  if (!file || !/\.[jt]sx$/.test(file))
    throw new Error("React interactive files must use .jsx or .tsx");
  const root = await realpath(baseDir);
  const component = await realpath(path.resolve(root, file));
  if (!component.startsWith(`${root}${path.sep}`))
    throw new Error("React interactive file escapes the configured directory");
  return component;
}

export function reactPreviewHtml(component: string): string {
  const moduleUrl = `/@fs/${component}`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>html,body{margin:0}.nawc-react-error{box-sizing:border-box;padding:16px;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;color:#b42318}</style>
  </head>
  <body>
    <div id="root"></div>
    <pre id="error" class="nawc-react-error" hidden></pre>
    <script>
      const reportHeight = () => parent.postMessage({ type: "nawc:interactive-resize", height: Math.ceil(document.body.scrollHeight) }, "*");
      new ResizeObserver(reportHeight).observe(document.documentElement);
      new ResizeObserver(reportHeight).observe(document.body);
      addEventListener("load", reportHeight);
      requestAnimationFrame(reportHeight);
    </script>
    <script type="module">
      const root = document.querySelector("#root");
      const error = document.querySelector("#error");
      try {
        const [{ createElement }, { createRoot }, module] = await Promise.all([
          import("react"),
          import("react-dom/client"),
          import(${JSON.stringify(moduleUrl)})
        ]);
        if (module.default == null) throw new Error("The component file must default-export a React component");
        createRoot(root).render(createElement(module.default));
      } catch (cause) {
        root.remove();
        error.hidden = false;
        error.textContent = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
      }
    </script>
  </body>
</html>`;
}

function reactVitePlugin(baseDir: string): Plugin {
  return {
    name: "nawc-react-interactive",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== PREVIEW_PATH) return next();
        try {
          const component = await resolveReactComponent(
            baseDir,
            url.searchParams.get("file") ?? "",
          );
          const html = await server.transformIndexHtml(url.pathname, reactPreviewHtml(component));
          response.statusCode = 200;
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

export function react() {
  return definePlugin({
    name: "react",
    client: "@nawc/react/client",
    nodes: [
      {
        name: "react-interactive",
        tag: "react-interactive",
        description: "Sandboxed React component",
      },
    ],
    skills: [{ name: "react", content: reactSkill }],
    vite: ({ baseDir }) => reactVitePlugin(baseDir),
  });
}
