import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createProject,
  DEFAULT_PLUGIN_IDS,
  detectPackageManager,
  EDITORS,
  isEditorId,
  isPluginId,
  isProviderId,
  isThemeId,
  packageName,
  parsePluginIds,
  PLUGINS,
  PROVIDERS,
  type Selection,
  THEMES,
} from "../src/create.ts";

const baseSelection: Selection = {
  providerId: "codex",
  editorId: "vscode",
  themeId: "light",
  baseDir: "..",
  pluginIds: ["core", "nawc-skills", "typescript", "vitest"],
};

describe("create-nawc", () => {
  it("detects the invoking package manager", () =>
    expect(detectPackageManager("pnpm/11.0.0 npm/? node/v24")).toBe("pnpm"));
  it("normalizes project names", () => expect(packageName("/tmp/My Notebook")).toBe("my-notebook"));
  it("defaults the plugin selection to core only", () =>
    expect(DEFAULT_PLUGIN_IDS).toEqual(["core"]));
  it("exposes one entry per available option in each catalog", () => {
    expect(PROVIDERS.map((entry) => entry.id)).toEqual(["codex", "cursor", "opencode", "pi"]);
    expect(EDITORS.map((entry) => entry.id)).toEqual([
      "vscode",
      "cursor",
      "clion",
      "idea",
      "webstorm",
      "zed",
    ]);
    expect(THEMES.map((entry) => entry.id)).toEqual(["light", "dark"]);
    expect(PLUGINS.map((entry) => entry.id)).toEqual([
      "core",
      "nawc-skills",
      "typescript",
      "vitest",
      "java",
      "junit",
      "react",
      "rust",
      "tailwind",
      "tldraw",
    ]);
  });
  it("validates catalog ids", () => {
    expect(isProviderId("codex")).toBe(true);
    expect(isProviderId("nope")).toBe(false);
    expect(isEditorId("vscode")).toBe(true);
    expect(isEditorId("vim")).toBe(false);
    expect(isThemeId("light")).toBe(true);
    expect(isThemeId("neon")).toBe(false);
    expect(isPluginId("core")).toBe(true);
    expect(isPluginId("missing")).toBe(false);
  });
  it("parses comma-separated plugin ids", () => {
    expect(parsePluginIds("core, typescript, vitest")).toEqual(["core", "typescript", "vitest"]);
    expect(parsePluginIds("")).toEqual([]);
    expect(parsePluginIds(",,core,")).toEqual(["core"]);
  });
  it("creates a deterministic notebook without installing", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "create-nawc-"));
    const root = path.join(parent, "docs");
    await createProject({
      directory: root,
      packageManager: "pnpm",
      install: false,
      selection: baseSelection,
    });
    const config = await readFile(path.join(root, "nawc.config.ts"), "utf8");
    expect(config).toContain("plugins: [core(), nawcSkills(), typescript(), vitest()]");
    expect(config).toContain("provider: codex()");
    expect(config).toContain("editor: vscode()");
    expect(config).toContain("theme: nawcLight()");
    expect(config).toContain('baseDir: ".."');
    await expect(readFile(path.join(root, "tsconfig.json"), "utf8")).resolves.toContain(
      '"module": "nodenext"',
    );
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    expect(pkg.dependencies).toEqual({
      "@nawc/cli": "latest",
      "@nawc/provider-codex": "latest",
      "@nawc/editor-vscode": "latest",
      "@nawc/theme-nawc": "latest",
      "@nawc/core": "latest",
      "@nawc/nawc-skills": "latest",
      "@nawc/syntax-typescript": "latest",
      "@nawc/syntax-vitest": "latest",
    });
    await expect(readFile(path.join(root, "src/Welcome.html"), "utf8")).resolves.toContain(
      "<interactive>",
    );
  });
  it("supports picking the cursor editor with the codex provider", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "create-nawc-"));
    const root = path.join(parent, "docs");
    await createProject({
      directory: root,
      packageManager: "pnpm",
      install: false,
      selection: { ...baseSelection, editorId: "cursor" },
    });
    const config = await readFile(path.join(root, "nawc.config.ts"), "utf8");
    expect(config).toContain('import { cursor } from "@nawc/editor-cursor";');
    expect(config).toContain("editor: cursor()");
  });
  it("aliases the cursor editor when the cursor provider is also selected", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "create-nawc-"));
    const root = path.join(parent, "docs");
    await createProject({
      directory: root,
      packageManager: "pnpm",
      install: false,
      selection: { ...baseSelection, providerId: "cursor", editorId: "cursor" },
    });
    const config = await readFile(path.join(root, "nawc.config.ts"), "utf8");
    expect(config).toContain('import { cursor } from "@nawc/provider-cursor";');
    expect(config).toContain('import { cursorEditor2 } from "@nawc/editor-cursor";');
    expect(config).toContain("provider: cursor()");
    expect(config).toContain("editor: cursorEditor2()");
  });
  it("honors a custom base dir and dark theme", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "create-nawc-"));
    const root = path.join(parent, "docs");
    await createProject({
      directory: root,
      packageManager: "pnpm",
      install: false,
      selection: { ...baseSelection, baseDir: "notebooks", themeId: "dark" },
    });
    const config = await readFile(path.join(root, "nawc.config.ts"), "utf8");
    expect(config).toContain("theme: nawcDark()");
    expect(config).toContain('baseDir: "notebooks"');
  });
  it("omits the plugins key when no plugins are selected", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "create-nawc-"));
    const root = path.join(parent, "docs");
    await createProject({
      directory: root,
      packageManager: "pnpm",
      install: false,
      selection: { ...baseSelection, pluginIds: [] },
    });
    const config = await readFile(path.join(root, "nawc.config.ts"), "utf8");
    expect(config).not.toContain("plugins:");
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    expect(pkg.dependencies["@nawc/core"]).toBeUndefined();
  });
});
