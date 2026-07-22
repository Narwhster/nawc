#!/usr/bin/env node
import path from "node:path";
import { cancel, intro, isCancel, multiselect, outro, select, text } from "@clack/prompts";
import { Command } from "commander";
import {
  createProject,
  DEFAULT_PLUGIN_IDS,
  detectPackageManager,
  EDITORS,
  isEditorId,
  isPluginId,
  isProviderId,
  isThemeId,
  parsePluginIds,
  PLUGINS,
  PROVIDERS,
  type PackageManager,
  type Selection,
  THEMES,
} from "./create.ts";

type CliOptions = {
  packageManager?: PackageManager;
  install: boolean;
  provider?: string;
  editor?: string;
  theme?: string;
  baseDir?: string;
  plugins?: string;
};

const program = new Command()
  .name("create-nawc")
  .description("Create a NAWC notebook")
  .argument("[directory]")
  .option("-m, --package-manager <manager>", "npm, pnpm, yarn, or bun")
  .option("--no-install", "skip dependency installation")
  .option("--provider <id>", `provider id: ${PROVIDERS.map((p) => p.id).join(", ")}`)
  .option("--editor <id>", `editor id: ${EDITORS.map((e) => e.id).join(", ")}`)
  .option("--theme <id>", `theme id: ${THEMES.map((t) => t.id).join(", ")}`, "light")
  .option("--base-dir <path>", "base directory used in nawc.config.ts", "..")
  .option(
    "--plugins <ids>",
    `comma-separated plugin ids (${PLUGINS.map((p) => p.id).join(", ")}); pass an empty value to disable the default`,
  )
  .action(async (directory: string | undefined, options: CliOptions) => {
    intro("Create NAWC");
    let selectedDirectory: string | symbol =
      directory ??
      (await text({
        message: "Where should the notebook be created?",
        placeholder: "nawc-notebook",
        defaultValue: "nawc-notebook",
      }));
    if (isCancel(selectedDirectory)) {
      cancel("Creation cancelled");
      process.exit(0);
    }
    let manager: PackageManager | symbol =
      options.packageManager ??
      (await select({
        message: "Package manager",
        initialValue: detectPackageManager(),
        options: ["pnpm", "npm", "yarn", "bun"].map((value) => ({
          value: value as PackageManager,
          label: value,
        })),
      }));
    if (isCancel(manager)) {
      cancel("Creation cancelled");
      process.exit(0);
    }
    if (!["npm", "pnpm", "yarn", "bun"].includes(manager))
      throw new Error(`Unsupported package manager: ${manager}`);

    const providerId = await resolveSingle({
      flag: options.provider,
      validate: isProviderId,
      prompt: {
        message: "Provider",
        options: PROVIDERS.map(({ id, label }) => ({ value: id, label })),
      },
    });

    const editorId = await resolveSingle({
      flag: options.editor,
      validate: isEditorId,
      prompt: {
        message: "Editor",
        options: EDITORS.map(({ id, label }) => ({ value: id, label })),
      },
    });

    const themeId = await resolveSingle({
      flag: options.theme,
      validate: isThemeId,
      prompt: {
        message: "Theme",
        options: THEMES.map(({ id, label }) => ({ value: id, label })),
      },
    });

    const baseDir = await resolveBaseDir(options.baseDir);

    const pluginIds = await resolvePlugins(options.plugins);

    const selection: Selection = {
      providerId,
      editorId,
      themeId: themeId as Selection["themeId"],
      baseDir,
      pluginIds,
    };

    const root = await createProject({
      directory: selectedDirectory,
      packageManager: manager as PackageManager,
      install: options.install,
      selection,
    });
    outro(
      `Created ${path.relative(process.cwd(), root) || path.basename(root)}. Run ${manager} nawc to begin.`,
    );
  });

async function resolveSingle<T extends string>({
  flag,
  validate,
  prompt,
}: {
  flag: string | undefined;
  validate: (value: string) => boolean;
  prompt: {
    message: string;
    options: { value: string; label: string }[];
  };
}): Promise<T> {
  const label = prompt.message.toLowerCase();
  if (flag !== undefined) {
    if (!validate(flag)) throw new Error(`Invalid ${label}: ${flag}`);
    return flag as T;
  }
  const answer = await select({
    message: prompt.message,
    options: prompt.options,
  });
  if (isCancel(answer)) {
    cancel("Creation cancelled");
    process.exit(0);
  }
  if (!validate(answer)) throw new Error(`Invalid ${label}: ${answer}`);
  return answer as T;
}

async function resolveBaseDir(flag: string | undefined): Promise<string> {
  if (flag !== undefined) {
    const trimmed = flag.trim();
    if (!trimmed) throw new Error("--base-dir must not be empty");
    return trimmed;
  }
  const answer = await text({
    message: "Base directory",
    placeholder: "..",
    defaultValue: "..",
    initialValue: "..",
  });
  if (isCancel(answer)) {
    cancel("Creation cancelled");
    process.exit(0);
  }
  return answer.trim() || "..";
}

async function resolvePlugins(flag: string | undefined): Promise<readonly string[]> {
  if (flag !== undefined) {
    const ids = parsePluginIds(flag);
    for (const id of ids) {
      if (!isPluginId(id)) throw new Error(`Invalid plugin id: ${id}`);
    }
    return ids;
  }
  const answer = await multiselect({
    message: "Plugins",
    options: PLUGINS.map(({ id, label }) => ({ value: id, label })),
    initialValues: [...DEFAULT_PLUGIN_IDS],
    required: false,
  });
  if (isCancel(answer)) {
    cancel("Creation cancelled");
    process.exit(0);
  }
  return answer as readonly string[];
}

program.parseAsync().catch((error: unknown) => {
  cancel(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
