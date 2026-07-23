import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type Selection = {
  providerId: string;
  editorId: string;
  themeId: "light" | "dark";
  baseDir: string;
  pluginIds: readonly string[];
};

export type CreateOptions = {
  directory: string;
  packageManager: PackageManager;
  install: boolean;
  selection: Selection;
};

export type CatalogEntry = {
  id: string;
  label: string;
  package: string;
  exportName: string;
};

export const PROVIDERS: readonly CatalogEntry[] = [
  { id: "codex", label: "Codex", package: "@nawc/provider-codex", exportName: "codex" },
  { id: "cursor", label: "Cursor", package: "@nawc/provider-cursor", exportName: "cursor" },
  { id: "opencode", label: "Opencode", package: "@nawc/provider-opencode", exportName: "opencode" },
  { id: "pi", label: "Pi", package: "@nawc/provider-pi", exportName: "pi" },
];

export const EDITORS: readonly CatalogEntry[] = [
  { id: "vscode", label: "VS Code", package: "@nawc/editor-vscode", exportName: "vscode" },
  { id: "cursor", label: "Cursor", package: "@nawc/editor-cursor", exportName: "cursor" },
  { id: "clion", label: "CLion", package: "@nawc/editor-clion", exportName: "clion" },
  { id: "idea", label: "IntelliJ IDEA", package: "@nawc/editor-idea", exportName: "idea" },
  { id: "webstorm", label: "WebStorm", package: "@nawc/editor-webstorm", exportName: "webstorm" },
  { id: "zed", label: "Zed", package: "@nawc/editor-zed", exportName: "zed" },
];

export const THEMES: readonly CatalogEntry[] = [
  { id: "light", label: "Light", package: "@nawc/theme-nawc", exportName: "nawcLight" },
  { id: "dark", label: "Dark", package: "@nawc/theme-nawc", exportName: "nawcDark" },
];

export const PLUGINS: readonly CatalogEntry[] = [
  { id: "core", label: "Core", package: "@nawc/core", exportName: "core" },
  {
    id: "nawc-skills",
    label: "NAWC Skills",
    package: "@nawc/nawc-skills",
    exportName: "nawcSkills",
  },
  {
    id: "typescript",
    label: "TypeScript",
    package: "@nawc/syntax-typescript",
    exportName: "typescript",
  },
  { id: "vitest", label: "Vitest", package: "@nawc/syntax-vitest", exportName: "vitest" },
  { id: "java", label: "Java", package: "@nawc/syntax-java", exportName: "java" },
  { id: "junit", label: "JUnit", package: "@nawc/syntax-junit", exportName: "junit" },
  { id: "react", label: "React", package: "@nawc/react", exportName: "react" },
  { id: "rust", label: "Rust", package: "@nawc/syntax-rust", exportName: "rust" },
  { id: "tailwind", label: "Tailwind", package: "@nawc/tailwind", exportName: "tailwind" },
  { id: "tldraw", label: "tldraw", package: "@nawc/tldraw", exportName: "tldraw" },
];

export const DEFAULT_PLUGIN_IDS: readonly string[] = ["core"];

export function detectPackageManager(
  userAgent = process.env.npm_config_user_agent,
): PackageManager {
  const name = userAgent?.split("/")[0];
  return name === "pnpm" || name === "yarn" || name === "bun" ? name : "npm";
}

export function packageName(directory: string): string {
  return path
    .basename(path.resolve(directory))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
}

export function isProviderId(value: string): boolean {
  return PROVIDERS.some((entry) => entry.id === value);
}

export function isEditorId(value: string): boolean {
  return EDITORS.some((entry) => entry.id === value);
}

export function isThemeId(value: string): value is Selection["themeId"] {
  return THEMES.some((entry) => entry.id === value);
}

export function isPluginId(value: string): boolean {
  return PLUGINS.some((entry) => entry.id === value);
}

export function parsePluginIds(raw: string): readonly string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

const welcome = `<h1>Welcome to NAWC</h1>
<p>This notebook lives in HTML and stays beside the code it describes.</p>
<h2>Interactive prototype</h2>
<interactive>
<script>
  let count = 0
  function inc(button) { button.textContent = ++count }
</script>
<button onclick="inc(this)" style="background:#facc15;border:0;padding:12px 18px;font:inherit">0</button>
</interactive>
`;

function findEntry<T extends CatalogEntry>(catalog: readonly T[], id: string): T {
  const entry = catalog.find((item) => item.id === id);
  if (!entry) throw new Error(`Unknown catalog id: ${id}`);
  return entry;
}

function uniqueImportName(used: Set<string>, exportName: string, hint: string): string {
  if (!used.has(exportName)) {
    used.add(exportName);
    return exportName;
  }
  let counter = 2;
  let candidate = `${hint}${counter}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${hint}${counter}`;
  }
  used.add(candidate);
  return candidate;
}

type NamedImport = { name: string; source: string; call: string };

function buildImports(parts: readonly NamedImport[]): string {
  return parts.map((part) => `import { ${part.name} } from "${part.source}";`).join("\n");
}

function generateConfig(selection: Selection): {
  config: string;
  dependencies: Record<string, string>;
} {
  const provider = findEntry(PROVIDERS, selection.providerId);
  const editor = findEntry(EDITORS, selection.editorId);
  const theme = findEntry(THEMES, selection.themeId);
  const plugins = selection.pluginIds.map((id) => findEntry(PLUGINS, id));

  const used = new Set<string>(["defineConfig"]);
  const imports: NamedImport[] = [{ name: "defineConfig", source: "nawc", call: "" }];

  const providerName = uniqueImportName(used, provider.exportName, `${provider.id}Provider`);
  imports.push({ name: providerName, source: provider.package, call: `${providerName}()` });

  const editorName = uniqueImportName(used, editor.exportName, `${editor.id}Editor`);
  imports.push({ name: editorName, source: editor.package, call: `${editorName}()` });

  const themeName = uniqueImportName(used, theme.exportName, `${theme.id}Theme`);
  imports.push({ name: themeName, source: theme.package, call: `${themeName}()` });

  const pluginNames: string[] = [];
  for (const plugin of plugins) {
    const name = uniqueImportName(used, plugin.exportName, `${plugin.id}Plugin`);
    pluginNames.push(`${name}()`);
    imports.push({ name, source: plugin.package, call: `${name}()` });
  }

  const lines: string[] = [buildImports(imports), "", "export default defineConfig({"];
  if (pluginNames.length > 0) lines.push(`  plugins: [${pluginNames.join(", ")}],`);
  lines.push(`  provider: ${providerName}(),`);
  lines.push(`  editor: ${editorName}(),`);
  lines.push(`  theme: ${themeName}(),`);
  lines.push(`  // change to "." if running nawc as a standalone project`);
  lines.push(`  baseDir: ${JSON.stringify(selection.baseDir)},`);
  lines.push("});");
  const config = `${lines.join("\n")}\n`;

  const dependencies: Record<string, string> = {
    nawc: "latest",
    [provider.package]: "latest",
    [editor.package]: "latest",
    [theme.package]: "latest",
    ...Object.fromEntries(plugins.map((plugin) => [plugin.package, "latest"])),
  };

  return { config, dependencies };
}

export async function createProject(options: CreateOptions): Promise<string> {
  const root = path.resolve(options.directory);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length > 0) throw new Error(`Directory is not empty: ${root}`);
  const { config, dependencies } = generateConfig(options.selection);
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: packageName(root), private: true, type: "module", scripts: { nawc: "nawc" }, dependencies }, null, 2)}\n`,
    "tsconfig.json": `${JSON.stringify({ compilerOptions: { noEmit: true, module: "nodenext", moduleResolution: "nodenext", allowImportingTsExtensions: true, esModuleInterop: true } }, null, 2)}\n`,
    "nawc.config.ts": config,
    "src/Welcome.html": welcome,
    ".gitignore": "node_modules\n.skills/\n.nawc/\n",
    "README.md": `# ${packageName(root)}\n\nRun \`${options.packageManager} nawc\` and open http://localhost:6292.\n`,
  };
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }
  if (options.install)
    await execa(options.packageManager, ["install"], { cwd: root, stdio: "inherit" });
  return root;
}

export async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
