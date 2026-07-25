#!/usr/bin/env node
import { Command } from "commander";
import { buildStaticNotebook, devStaticNotebook, previewStaticNotebook } from "./build.ts";

type Options = {
  readonly config: string;
  readonly siteConfig: string;
  readonly outDir: string;
  readonly port?: number;
  readonly host?: string;
};

const common = (command: Command) =>
  command
    .option("-c, --config <file>", "notebook config file", "nawc.config.ts")
    .option("-s, --site-config <file>", "static site config file", "nawc-site.config.ts")
    .option("-o, --out-dir <directory>", "static output directory", "dist");

const serve = async (kind: "dev" | "preview", options: Options) => {
  const siteOptions = {
    projectDir: process.cwd(),
    configFile: options.config,
    agentFile: options.siteConfig,
    outDir: options.outDir,
    port: options.port,
    host: options.host,
  };
  const server =
    kind === "dev"
      ? await devStaticNotebook(siteOptions)
      : await previewStaticNotebook(siteOptions);
  server.printUrls();
  const close = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
};

const program = new Command()
  .name("nawc-site")
  .description("Build a NAWC notebook as a static site");

common(program.command("build").description("build the static notebook")).action(
  async (options: Options) => {
    const outDir = await buildStaticNotebook({
      projectDir: process.cwd(),
      configFile: options.config,
      agentFile: options.siteConfig,
      outDir: options.outDir,
    });
    console.log(`Built static notebook at ${outDir}`);
  },
);

common(program.command("dev").description("start a development server"))
  .option("-p, --port <port>", "port to listen on", Number)
  .option("-H, --host <host>", "host/interface to bind to")
  .action((options: Options) => serve("dev", options));

for (const name of ["start", "preview"]) {
  common(program.command(name).description("serve the built static notebook"))
    .option("-p, --port <port>", "port to listen on", Number)
    .option("-H, --host <host>", "host/interface to bind to")
    .action((options: Options) => serve("preview", options));
}

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
