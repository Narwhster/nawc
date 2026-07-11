#!/usr/bin/env node
import { Command } from "commander";
import { createNawcServer } from "./server.ts";

const program = new Command()
  .name("nawc")
  .description("Start a NAWC notebook")
  .option("-p, --port <port>", "port to listen on", Number)
  .option("-c, --config <file>", "configuration file", "nawc.config.ts")
  .action(async (options: { port?: number; config: string }) => {
    const running = await createNawcServer({
      projectDir: process.cwd(),
      configFile: options.config,
      port: options.port,
    });
    console.log(`NAWC is ready at ${running.url}`);
    const close = async () => {
      await running.close();
      process.exit(0);
    };
    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
