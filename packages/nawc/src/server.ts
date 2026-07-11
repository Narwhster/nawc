import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import type { NawcConfig, SourceSelection } from "@nawc/config";
import { watch } from "chokidar";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createJiti } from "jiti";
import { type IPty, spawn } from "node-pty";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
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
  safeExistingPath,
  safePath,
  writeNote,
} from "./workspace.ts";
import { syncSkills } from "./skills.ts";
import { isSameOrigin, parseRunClientEvent } from "./run-protocol.ts";
import { launchEditor } from "./editor.ts";
import { vscode } from "@nawc/config";

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

function rawDataText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return data.toString();
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
      editor: {
        name: (config.editor ?? vscode()).name,
        label: (config.editor ?? vscode()).label,
        icon: (config.editor ?? vscode()).icon,
      },
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
  app.post("/api/editor/open", async (context) => {
    const request = await context.req.json<{
      file: string;
      scope: "note" | "source";
      line?: number;
      column?: number;
    }>();
    if (request.scope !== "note" && request.scope !== "source")
      throw new Error("Invalid editor scope");
    if (request.line !== undefined && (!Number.isInteger(request.line) || request.line < 1))
      throw new Error("Invalid editor line");
    if (request.column !== undefined && (!Number.isInteger(request.column) || request.column < 1))
      throw new Error("Invalid editor column");
    const file = await safeExistingPath(request.scope === "note" ? srcDir : baseDir, request.file);
    await launchEditor(config.editor ?? vscode(), {
      file,
      line: request.line,
      column: request.column,
    });
    return context.json({ ok: true });
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
  const runSockets = new WebSocketServer({ noServer: true });
  const startRun = async (
    webSocket: WebSocket,
    selection: SourceSelection,
    size: { cols: number; rows: number },
  ): Promise<IPty | undefined> => {
    try {
      const syntax = config.syntax.find(
        (item) => item.name === selection.syntax || item.aliases.includes(selection.syntax ?? ""),
      );
      if (!syntax?.run) throw new Error(`Syntax ${selection.syntax ?? ""} is not runnable`);
      await safePath(baseDir, selection.file);
      const run = syntax.run({ ...selection, cwd: baseDir });
      const [command, ...args] = run.command;
      if (!command) throw new Error("Runnable syntax returned an empty command");

      const child = spawn(command, args, {
        cols: size.cols,
        cwd: run.cwd,
        env: { ...process.env, TERM: "xterm-256color" },
        name: "xterm-256color",
        rows: size.rows,
      });
      child.onData((data) => {
        if (webSocket.readyState === webSocket.OPEN)
          webSocket.send(JSON.stringify({ type: "output", data }));
      });
      child.onExit(({ exitCode }) => {
        if (webSocket.readyState === webSocket.OPEN) {
          webSocket.send(JSON.stringify({ type: "exit", exitCode }));
          webSocket.close(1000, String(exitCode));
        }
      });
      return child;
    } catch (error) {
      if (webSocket.readyState === webSocket.OPEN) {
        webSocket.send(JSON.stringify({ type: "error", message: message(error) }));
        webSocket.close(1011, "Runnable failed");
      }
    }
  };
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "", "http://localhost").pathname !== "/api/run") {
      socket.destroy();
      return;
    }
    if (!isSameOrigin(request.headers.origin, request.headers.host)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    runSockets.handleUpgrade(request, socket, head, (webSocket) => {
      runSockets.emit("connection", webSocket, request);
    });
  });
  runSockets.on("connection", (webSocket) => {
    let child: IPty | undefined;
    let closed = false;
    const pendingInput: string[] = [];
    let pendingSize: { cols: number; rows: number } | undefined;
    let starting = false;
    webSocket.on("message", (data: RawData) => {
      const event = parseRunClientEvent(rawDataText(data));
      if (!event) {
        webSocket.close(1008, "Invalid runnable message");
        return;
      }
      try {
        if (event.type === "start" && !child && !starting) {
          starting = true;
          void startRun(webSocket, event.selection, {
            cols: Math.max(1, Math.min(500, event.cols)),
            rows: Math.max(1, Math.min(200, event.rows)),
          }).then((process) => {
            if (closed) {
              process?.kill();
              return;
            }
            child = process;
            if (pendingSize) child?.resize(pendingSize.cols, pendingSize.rows);
            for (const input of pendingInput) child?.write(input);
          });
        } else if (event.type === "input") {
          if (child) child.write(event.data);
          else if (starting) pendingInput.push(event.data);
        } else if (event.type === "resize") {
          const size = {
            cols: Math.max(1, Math.min(500, event.cols)),
            rows: Math.max(1, Math.min(200, event.rows)),
          };
          if (child) child.resize(size.cols, size.rows);
          else if (starting) pendingSize = size;
        }
      } catch {
        webSocket.close(1008, "Invalid runnable message");
      }
    });
    webSocket.on("close", () => {
      closed = true;
      child?.kill();
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
      for (const webSocket of runSockets.clients) webSocket.close(1001, "Server shutting down");
      runSockets.close();
      await watcher.close();
      await vite.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
