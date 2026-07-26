#!/usr/bin/env node
import { Command } from "commander";
import type { NawcConfig } from "@nawc/config";
import { createJiti } from "jiti";
import path from "node:path";
import { assertGitRepository } from "./workspace.ts";
import { computeSplash, type SplashResult } from "./splash.ts";
import { createNawcServer } from "./server.ts";

type SharedOptions = {
  readonly config: string;
};

async function loadConfig(projectDir: string, configFile: string): Promise<NawcConfig> {
  const file = path.resolve(projectDir, configFile);
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  return jiti.import<NawcConfig>(file, { default: true });
}

function formatSplash(result: SplashResult): string {
  const lines: string[] = [];
  lines.push("# Splash Zone");
  if (result.zone.length === 0) {
    lines.push("- (none)");
  } else {
    for (const note of result.zone) lines.push(`- ${note}`);
  }
  for (const layer of result.layers) {
    if (layer.links.length === 0) continue;
    lines.push("");
    lines.push(`# Related - Depth ${layer.depth}`);
    for (const link of layer.links)
      lines.push(`- ${link.source} references ${link.targets.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

async function runSplash(
  projectDir: string,
  options: SharedOptions & { readonly depth: number },
): Promise<void> {
  const config = await loadConfig(projectDir, options.config);
  const baseDir = path.resolve(projectDir, config.baseDir);
  await assertGitRepository(baseDir);
  const srcDir = path.join(projectDir, "src");
  const result = await computeSplash({
    srcDir,
    baseDir,
    plugins: config.plugins,
    depth: options.depth,
  });
  process.stdout.write(formatSplash(result));
}

const program = new Command()
  .name("nawc")
  .description("Start a NAWC notebook")
  .option("-p, --port <port>", "port to listen on", Number)
  .option("-H, --host <host>", "host/interface to bind to")
  .option("-c, --config <file>", "configuration file", "nawc.config.ts")
  .action(async (options: { port?: number; host?: string; config: string }) => {
    const running = await createNawcServer({
      projectDir: process.cwd(),
      configFile: options.config,
      port: options.port,
      host: options.host,
    });
    console.log(`NAWC is ready at ${running.url}`);
    const close = async () => {
      await running.close();
      process.exit(0);
    };
    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());
  });

program
  .command("splash")
  .description("List notes whose referenced files are modified in the worktree")
  .option(
    "-d, --depth <depth>",
    "how many wiki-link hops to follow",
    (value) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0)
        throw new Error("Depth must be a non-negative integer");
      return parsed;
    },
    0,
  )
  .option("-c, --config <file>", "configuration file", "nawc.config.ts")
  .action(async (options: { depth: number; config: string }) => {
    await runSplash(process.cwd(), options);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
