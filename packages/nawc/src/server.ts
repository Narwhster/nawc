import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import type { NawcConfig, SourceSelection } from "@nawc/config";
import { watch } from "chokidar";
import { execa } from "execa";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createJiti } from "jiti";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import {
  assertGitRepository,
  createFolder,
  deleteEntry,
  deleteNote,
  listEntries,
  listNotes,
  moveEntry,
  readNote,
  renameEntry,
  renameNote,
  resolveSource,
  safePath,
  writeNote,
} from "./workspace.ts";
import { syncSkills } from "./skills.ts";

type ServerOptions = {
  readonly projectDir: string;
  readonly configFile?: string;
  readonly port?: number;
};
type RunningServer = {
  readonly server: Server;
  readonly vite: ViteDevServer;
  readonly url: string;
  close(): Promise<void>;
};

async function loadConfig(projectDir: string, configFile = "nawc.config.ts"): Promise<NawcConfig> {
  const file = path.resolve(projectDir, configFile);
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  return jiti.import<NawcConfig>(file, { default: true });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createNawcServer(options: ServerOptions): Promise<RunningServer> {
  const projectDir = path.resolve(options.projectDir);
  const config = await loadConfig(projectDir, options.configFile);
  const baseDir = path.resolve(projectDir, config.baseDir);
  const srcDir = path.join(projectDir, "src");
  await assertGitRepository(baseDir);
  const skillsDir = await syncSkills(projectDir, config.plugins);
  const fileListeners = new Set<(event: string, file: string) => void>();
  const watcher = watch(srcDir, {
    ignored: ["**/.git/**", "**/node_modules/**", "**/.skills/**"],
    ignoreInitial: true,
    usePolling: true,
    interval: 500,
  });
  watcher.on("all", (event, file) => {
    for (const listener of fileListeners) listener(event, file);
  });

  const app = new Hono();
  app.onError((error, context) => context.json({ error: message(error) }, 400));
  app.get("/api/meta", (context) =>
    context.json({
      provider: config.provider.name,
      baseDir,
      plugins: config.plugins.map(({ name, nodes }) => ({ name, nodes })),
    }),
  );
  app.get("/api/notes", async (context) => context.json(await listNotes(srcDir)));
  app.get("/api/files", async (context) => context.json(await listEntries(srcDir)));
  app.get("/api/events", (context) =>
    streamSSE(context, async (stream) => {
      await stream.writeSSE({ data: JSON.stringify({ event: "ready" }) });
      await new Promise<void>((resolve) => {
        const listener = (event: string, file: string) =>
          void stream.writeSSE({
            data: JSON.stringify({ event, file: path.relative(srcDir, file) }),
          });
        fileListeners.add(listener);
        stream.onAbort(() => {
          fileListeners.delete(listener);
          resolve();
        });
      });
    }),
  );
  app.get("/api/note", async (context) =>
    context.text(await readNote(srcDir, context.req.query("path") ?? "")),
  );
  app.put("/api/note", async (context) => {
    const body = await context.req.json<{ path: string; content: string }>();
    await writeNote(srcDir, body.path, body.content);
    return context.json({ ok: true });
  });
  app.delete("/api/note", async (context) => {
    await deleteNote(srcDir, context.req.query("path") ?? "");
    return context.json({ ok: true });
  });
  app.post("/api/note/rename", async (context) => {
    const body = await context.req.json<{ from: string; to: string }>();
    await renameNote(srcDir, body.from, body.to);
    return context.json({ ok: true });
  });
  app.post("/api/folder", async (context) => {
    const { path: folder } = await context.req.json<{ path: string }>();
    await createFolder(srcDir, folder);
    return context.json({ ok: true });
  });
  app.delete("/api/entry", async (context) => {
    await deleteEntry(srcDir, context.req.query("path") ?? "");
    return context.json({ ok: true });
  });
  app.post("/api/entry/rename", async (context) => {
    const body = await context.req.json<{ from: string; to: string }>();
    await renameEntry(srcDir, body.from, body.to);
    return context.json({ ok: true });
  });
  app.post("/api/entry/move", async (context) => {
    const body = await context.req.json<{ from: string; to: string; replace?: boolean }>();
    await moveEntry(srcDir, body.from, body.to, body.replace);
    return context.json({ ok: true });
  });
  app.post("/api/source", async (context) => {
    const selection = await context.req.json<SourceSelection>();
    watcher.add(await safePath(baseDir, selection.file));
    return context.json(await resolveSource(config, baseDir, selection));
  });
  app.post("/api/run", async (context) => {
    const selection = await context.req.json<SourceSelection>();
    const syntax = config.syntax.find(
      (item) => item.name === selection.syntax || item.aliases.includes(selection.syntax ?? ""),
    );
    if (!syntax?.run) throw new Error(`Syntax ${selection.syntax ?? ""} is not runnable`);
    await safePath(baseDir, selection.file);
    const run = syntax.run({ ...selection, cwd: baseDir });
    const [command, ...args] = run.command;
    if (!command) throw new Error("Runnable syntax returned an empty command");
    const result = await execa(command, args, { cwd: run.cwd, reject: false });
    return context.json({
      command: run.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  });
  app.post("/api/prompt", async (context) => {
    const { prompt } = await context.req.json<{ prompt: string }>();
    return streamSSE(context, async (stream) => {
      for await (const event of config.provider.prompt({ prompt, cwd: baseDir, skillsDir }))
        await stream.writeSSE({ data: JSON.stringify(event), event: event.type });
    });
  });

  const uiRoot = path.dirname(fileURLToPath(import.meta.resolve("@nawc/ui/package.json")));
  const projectRequire = createRequire(path.join(projectDir, "package.json"));
  const pluginImports = config.plugins
    .map(
      (plugin, index) =>
        `import plugin${index} from ${JSON.stringify(projectRequire.resolve(plugin.client))};`,
    )
    .join("\n");
  const pluginArray = config.plugins.map((_, index) => `plugin${index}`).join(", ");
  const vite = await createViteServer({
    root: uiRoot,
    appType: "spa",
    resolve: {
      alias: { "@": path.join(uiRoot, "src") },
      dedupe: ["react", "react-dom"],
    },
    server: {
      middlewareMode: true,
      hmr: false,
      watch: { usePolling: true, interval: 500 },
      fs: { allow: [projectDir, baseDir, uiRoot] },
    },
    plugins: [
      {
        name: "nawc-configured-plugins",
        resolveId(id) {
          return id === "virtual:nawc-plugins" ? "\0virtual:nawc-plugins" : undefined;
        },
        load(id) {
          return id === "\0virtual:nawc-plugins"
            ? `${pluginImports}\nexport default [${pluginArray}];`
            : undefined;
        },
      },
    ],
  });
  const api = getRequestListener(app.fetch);
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/api/")) void api(request, response);
    else
      vite.middlewares(request, response, (error: unknown) => {
        response.statusCode = 500;
        response.end(message(error));
      });
  });
  const port = options.port ?? config.port ?? 6292;
  await new Promise<void>((resolve, reject) =>
    server.listen(port, "127.0.0.1", resolve).once("error", reject),
  );
  return {
    server,
    vite,
    url: `http://localhost:${port}`,
    async close() {
      await watcher.close();
      await vite.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
