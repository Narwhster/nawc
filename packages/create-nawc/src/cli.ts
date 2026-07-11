#!/usr/bin/env node
import path from "node:path";
import { cancel, intro, isCancel, outro, select, text } from "@clack/prompts";
import { Command } from "commander";
import { createProject, detectPackageManager, type PackageManager } from "./create.ts";

const program = new Command()
  .name("create-nawc")
  .description("Create a NAWC notebook")
  .argument("[directory]")
  .option("-m, --package-manager <manager>", "npm, pnpm, yarn, or bun")
  .option("--no-install", "skip dependency installation")
  .action(
    async (
      directory: string | undefined,
      options: { packageManager?: PackageManager; install: boolean },
    ) => {
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
      const root = await createProject({
        directory: selectedDirectory,
        packageManager: manager as PackageManager,
        install: options.install,
      });
      outro(
        `Created ${path.relative(process.cwd(), root) || path.basename(root)}. Run ${manager} nawc to begin.`,
      );
    },
  );

program.parseAsync().catch((error: unknown) => {
  cancel(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
