import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { NawcConfig, NawcTheme } from "@nawc/config";
import tailwindcss from "@tailwindcss/vite";
import { createJiti } from "jiti";
import {
  build as viteBuild,
  createServer as createViteServer,
  preview as vitePreview,
  type InlineConfig,
  type Plugin,
  type PreviewServer,
  type ViteDevServer,
} from "vite";
import type { StaticNotebookData } from "./browser.ts";

type SiteOptions = {
  readonly projectDir: string;
  readonly configFile?: string;
  readonly agentFile?: string;
  readonly outDir?: string;
  readonly port?: number;
  readonly host?: string;
};

const supportedSyntaxes = new Set(["typescript", "ts", "tsx", "javascript", "js", "jsx"]);

const hljsLanguageAliases: Record<string, string> = {
  bash: "bash",
  cjs: "javascript",
  css: "css",
  htm: "xml",
  html: "xml",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  python: "python",
  rs: "rust",
  rust: "rust",
  sh: "bash",
  shell: "bash",
  sql: "sql",
  test: "typescript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  vitest: "typescript",
  vue: "xml",
  xml: "xml",
  zsh: "bash",
};

function discoverHljsLanguages(notes: Record<string, string>, sourceFiles: string[]): Set<string> {
  const langs = new Set<string>(["typescript", "javascript", "xml"]);
  for (const html of Object.values(notes)) {
    for (const match of html.matchAll(
      /<(?:code|runnable|interactive)\b[^>]*?syntax=(?:"([^"]+)"|'([^']+)')/gi,
    )) {
      const syntax = (match[1] ?? match[2] ?? "").toLowerCase().trim();
      if (syntax) langs.add(hljsLanguageAliases[syntax] ?? syntax);
    }
  }
  for (const file of sourceFiles) {
    const ext = file.split(/[\\/.]/).pop();
    if (ext && ext !== file) langs.add(hljsLanguageAliases[ext] ?? ext);
  }
  return langs;
}

let cachedNotebookData: StaticNotebookData | undefined;
let cachedHljsLangs: string[] | undefined;

const emptyTheme: NawcTheme = {
  name: "nawc-light",
  appearance: "light",
  variables: {},
};

async function listFiles(root: string, extension?: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (!extension || entry.name.endsWith(extension))
        files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  };
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function staticHtml(html: string): string {
  return html.replace(
    /<runnable\b([^>]*)>([\s\S]*?)<\/runnable>/gi,
    (tag, attributes: string, content: string) => {
      const syntax = attributes.match(/\bsyntax=(?:"([^"]+)"|'([^']+)')/i);
      const name = (syntax?.[1] ?? syntax?.[2])?.toLowerCase();
      return !name || supportedSyntaxes.has(name) ? tag : `<code${attributes}>${content}</code>`;
    },
  );
}

function referencedFiles(html: string): string[] {
  const files = new Set<string>();
  const nodes = html.matchAll(/<(?:code|runnable|interactive)\b([^>]*)>/gi);
  for (const node of nodes) {
    const file = node[1]?.match(/\bfile=(?:"([^"]+)"|'([^']+)')/i);
    const value = (file?.[1] ?? file?.[2])?.trim();
    if (value) files.add(value);
  }
  return [...files];
}

async function loadConfig(projectDir: string, configFile: string): Promise<NawcConfig> {
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  return jiti.import<NawcConfig>(path.resolve(projectDir, configFile), { default: true });
}

export async function loadStaticNotebookData(
  projectDir: string,
  configFile = "nawc.config.ts",
): Promise<StaticNotebookData> {
  if (cachedNotebookData) return cachedNotebookData;
  const config = await loadConfig(projectDir, configFile);
  const srcDir = path.join(projectDir, "src");
  const notePaths = await listFiles(srcDir, ".html");
  const notes: Record<string, string> = {};
  const references = new Set<string>();
  for (const notePath of notePaths) {
    const html = staticHtml(await readFile(path.join(srcDir, notePath), "utf8"));
    notes[notePath] = html;
    for (const file of referencedFiles(html)) references.add(file);
  }
  const baseDir = path.resolve(projectDir, config.baseDir);
  const sources: Record<string, string> = {};
  for (const file of references) {
    const absolute = path.resolve(baseDir, file);
    const relative = path.relative(baseDir, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(`Source reference escapes baseDir: ${file}`);
    sources[file.split(path.sep).join("/")] = await readFile(absolute, "utf8");
  }
  const plugins = config.plugins
    .filter((plugin) => plugin.name === "core" || plugin.name === "typescript")
    .map(({ name, nodes }) => ({ name, nodes }));
  const data: StaticNotebookData = { notes, sources, theme: config.theme ?? emptyTheme, plugins };
  cachedNotebookData = data;
  cachedHljsLangs = [...discoverHljsLanguages(notes, Object.keys(sources))];
  return data;
}

function resetCache() {
  cachedNotebookData = undefined;
  cachedHljsLangs = undefined;
}

function packagePaths() {
  const require = createRequire(import.meta.url);
  const uiRoot = path.dirname(
    fileURLToPath(pathToFileURL(require.resolve("@nawc/ui/package.json"))),
  );
  const uiRequire = createRequire(path.join(uiRoot, "package.json"));
  const coreClient = require.resolve("@nawc/core/client");
  const browserEntry = fileURLToPath(new URL("./browser.mjs", import.meta.url));
  const fontRoot = path.dirname(
    uiRequire.resolve("@fontsource-variable/jetbrains-mono/package.json"),
  );
  return { uiRoot, coreClient, browserEntry, fontRoot };
}

function staticNotebookPlugin(
  options: Required<Pick<SiteOptions, "projectDir" | "configFile" | "agentFile">>,
): Plugin {
  const { uiRoot, coreClient, browserEntry } = packagePaths();
  const coreRequire = createRequire(coreClient);
  const virtualEntry = "\0virtual:nawc-site-entry";
  const virtualData = "\0virtual:nawc-site-data";
  const virtualPlugins = "\0virtual:nawc-plugins";
  const virtualHljs = "\0virtual:nawc-highlightjs";
  const uiMain = path.join(uiRoot, "src/main.tsx");
  const agentPath = path.resolve(options.projectDir, options.agentFile);
  const srcDir = path.join(options.projectDir, "src");

  return {
    name: "nawc-static-notebook",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replace("/src/main.tsx", "/@nawc-site-entry");
      },
    },
    resolveId(id) {
      if (id === "/@nawc-site-entry") return virtualEntry;
      if (id === "virtual:nawc-static-data") return virtualData;
      if (id === "virtual:nawc-plugins") return virtualPlugins;
      if (id === "virtual:nawc-highlightjs") return virtualHljs;
      return undefined;
    },
    async load(id) {
      if (id === virtualEntry)
        return [
          `import agent from ${JSON.stringify(agentPath)};`,
          `import data from "virtual:nawc-static-data";`,
          `import { installStaticRuntime } from ${JSON.stringify(browserEntry)};`,
          "installStaticRuntime({ ...data, agent });",
          `await import(${JSON.stringify(uiMain)});`,
        ].join("\n");
      if (id === virtualData)
        return `export default ${JSON.stringify(
          await loadStaticNotebookData(options.projectDir, options.configFile),
        )};`;
      if (id === virtualPlugins)
        return [
          `import core from ${JSON.stringify(coreClient)};`,
          'export const syntaxes = [{ name: "typescript", aliases: ["ts", "tsx"], highlight: "typescript" }];',
          "export default [core];",
        ].join("\n");
      if (id === virtualHljs) {
        if (!cachedHljsLangs) await loadStaticNotebookData(options.projectDir, options.configFile);
        const corePath = coreRequire.resolve("highlight.js/lib/core");
        const coreCjs = await readFile(corePath, "utf8");
        const langEntries: { lang: string; path: string }[] = [];
        for (const lang of cachedHljsLangs ?? []) {
          try {
            langEntries.push({
              lang,
              path: coreRequire.resolve(`highlight.js/lib/languages/${lang}`),
            });
          } catch {
            continue;
          }
        }
        const langModules: string[] = [];
        for (const e of langEntries) {
          const langCjs = await readFile(e.path, "utf8");
          langModules.push(
            `var lang_${e.lang} = (function() { var module = { exports: {} }; var exports = module.exports;\n` +
              langCjs +
              `\nreturn module.exports; })();`,
          );
        }
        const registrations = langEntries.map(
          (e) => `hljs.registerLanguage(${JSON.stringify(e.lang)}, lang_${e.lang});`,
        );
        return [
          `var module = { exports: {} };\nvar exports = module.exports;`,
          coreCjs,
          `var hljs = module.exports;`,
          ...langModules,
          ...registrations,
          `export default hljs;`,
        ].join("\n");
      }
      return undefined;
    },
    configureServer(server) {
      server.watcher.add([srcDir, agentPath, path.resolve(options.projectDir, options.configFile)]);
      const reload = (file: string) => {
        if (
          file === agentPath ||
          file === path.resolve(options.projectDir, options.configFile) ||
          file.startsWith(`${srcDir}${path.sep}`)
        ) {
          resetCache();
          for (const id of [virtualData, virtualHljs]) {
            const module = server.moduleGraph.getModuleById(id);
            if (module) server.moduleGraph.invalidateModule(module);
          }
          server.ws.send({ type: "full-reload" });
        }
      };
      server.watcher.on("add", reload);
      server.watcher.on("change", reload);
      server.watcher.on("unlink", reload);
    },
  };
}

function viteConfig(options: SiteOptions): InlineConfig {
  const projectDir = path.resolve(options.projectDir);
  const configFile = options.configFile ?? "nawc.config.ts";
  const agentFile = options.agentFile ?? "nawc-static-agent.ts";
  const outDir = path.resolve(projectDir, options.outDir ?? "dist");
  const { uiRoot, browserEntry, coreClient, fontRoot } = packagePaths();
  return {
    configFile: false,
    root: uiRoot,
    base: "./",
    appType: "spa" as const,
    publicDir: false,
    resolve: {
      alias: {
        "@nawcui": path.join(uiRoot, "src"),
        "highlight.js/lib/common": "virtual:nawc-highlightjs",
      },
      dedupe: ["react", "react-dom"],
    },
    server: {
      port: options.port,
      host: options.host,
      fs: {
        allow: [projectDir, uiRoot, browserEntry, coreClient, fontRoot],
      },
    },
    preview: { port: options.port, host: options.host },
    build: { outDir, emptyOutDir: true },
    plugins: [tailwindcss(), staticNotebookPlugin({ projectDir, configFile, agentFile })],
  };
}

export async function buildStaticNotebook(options: SiteOptions): Promise<string> {
  await viteBuild(viteConfig(options));
  return path.resolve(options.projectDir, options.outDir ?? "dist");
}

export async function devStaticNotebook(options: SiteOptions): Promise<ViteDevServer> {
  const server = await createViteServer(viteConfig(options));
  await server.listen();
  return server;
}

export async function previewStaticNotebook(options: SiteOptions): Promise<PreviewServer> {
  return vitePreview(viteConfig(options));
}
