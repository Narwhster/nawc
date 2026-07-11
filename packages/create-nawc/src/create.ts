import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type CreateOptions = { directory: string; packageManager: PackageManager; install: boolean };

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

export async function createProject(options: CreateOptions): Promise<string> {
  const root = path.resolve(options.directory);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length > 0) throw new Error(`Directory is not empty: ${root}`);
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: packageName(root), private: true, type: "module", scripts: { nawc: "nawc" }, dependencies: { nawc: "latest", "@nawc/core": "latest", "@nawc/provider-codex": "latest", "@nawc/syntax-typescript": "latest", "@nawc/syntax-vitest": "latest" } }, null, 2)}\n`,
    "nawc.config.ts": `import { defineConfig, vscode } from "nawc";\nimport { core } from "@nawc/core";\nimport { codex } from "@nawc/provider-codex";\nimport { typescript } from "@nawc/syntax-typescript";\nimport { vitest } from "@nawc/syntax-vitest";\n\nexport default defineConfig({\n  plugins: [core()],\n  provider: codex(),\n  syntax: [typescript(), vitest()],\n  editor: vscode(),\n  baseDir: "..",\n});\n`,
    "src/Welcome.html": welcome,
    ".gitignore": "node_modules\n.skills\n",
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
