import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import type {
  NawcConfig,
  NawcProviderModel,
  NawcProviderSettings,
  NawcProviderSkill,
  PromptReference,
  SourceSelection,
} from "@nawc/config";
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
  isProjectPath,
  listEntries,
  listNotes,
  listProjectPaths,
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
import { vscode } from "@nawc/editor-vscode";
import { nawcLight } from "@nawc/theme-nawc";
import { NoteSearchIndex } from "./note-search.ts";
import { AgentManager } from "./agent-manager.ts";
import { validateAgentAttachments } from "./agent-input.ts";

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

type PromptSkill = {
  readonly name: string;
  readonly path: string;
  readonly source: string;
  readonly displayName?: string;
  readonly shortDescription?: string;
  readonly description?: string;
  readonly scope?: string;
};

async function listPromptSkills(
  config: NawcConfig,
  skillsDir: string,
  providerSkills: readonly NawcProviderSkill[],
): Promise<readonly PromptSkill[]> {
  const skills: PromptSkill[] = providerSkills
    .filter((skill) => skill.enabled !== false)
    .map((skill: NawcProviderSkill) => ({
      name: skill.name,
      path: skill.path,
      source: skill.scope ? `${config.provider.name} · ${skill.scope}` : config.provider.name,
      ...(skill.displayName ? { displayName: skill.displayName } : {}),
      ...(skill.shortDescription ? { shortDescription: skill.shortDescription } : {}),
      ...(skill.description ? { description: skill.description } : {}),
      ...(skill.scope ? { scope: skill.scope } : {}),
    }));
  for (const plugin of config.plugins) {
    for (const skill of plugin.skills ?? []) {
      skills.push({
        name: skill.name,
        path: await safeExistingPath(skillsDir, path.join(skill.name, "SKILL.md")),
        source: plugin.name,
        displayName: skill.name,
        shortDescription: "NAWC plugin skill",
      });
    }
  }
  return skills;
}

export async function createNawcServer(options: ServerOptions): Promise<RunningServer> {
  const projectDir = path.resolve(options.projectDir);
  const config = await loadConfig(projectDir, options.configFile);
  const baseDir = path.resolve(projectDir, config.baseDir);
  const srcDir = path.join(projectDir, "src");
  const noteSearch = new NoteSearchIndex(srcDir);
  await assertGitRepository(baseDir);
  const skillsDir = await syncSkills(projectDir, config.plugins);
  const agentManager = new AgentManager({
    provider: config.provider,
    cwd: baseDir,
    skillsDir,
  });
  let providerSkillsPromise: Promise<readonly NawcProviderSkill[]> | undefined;
  let providerModelsPromise: Promise<readonly NawcProviderModel[]> | undefined;
  let providerSettingsPromise: Promise<NawcProviderSettings> | undefined;
  const getProviderSkills = () => {
    if (!providerSkillsPromise) {
      const promise = config.provider.listSkills
        ? config.provider.listSkills({ cwd: baseDir })
        : Promise.resolve<readonly NawcProviderSkill[]>([]);
      providerSkillsPromise = promise.catch((error: unknown) => {
        providerSkillsPromise = undefined;
        throw error;
      });
    }
    return providerSkillsPromise;
  };
  const getPromptSkills = async () =>
    listPromptSkills(config, skillsDir, await getProviderSkills());
  const getProviderModels = () => {
    if (!providerModelsPromise) {
      const promise = config.provider.listModels
        ? config.provider.listModels({ cwd: baseDir })
        : Promise.resolve<readonly NawcProviderModel[]>([]);
      providerModelsPromise = promise.catch((error: unknown) => {
        providerModelsPromise = undefined;
        throw error;
      });
    }
    return providerModelsPromise;
  };
  const getProviderSettings = () => {
    if (!providerSettingsPromise) {
      const promise = config.provider.getSettings
        ? config.provider.getSettings({ cwd: baseDir })
        : Promise.resolve<NawcProviderSettings>({});
      providerSettingsPromise = promise.catch((error: unknown) => {
        providerSettingsPromise = undefined;
        throw error;
      });
    }
    return providerSettingsPromise;
  };
  const validateAgentSelection = async (selection: {
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly options?: readonly { readonly id: string; readonly value: string | boolean }[];
  }) => {
    const models = await getProviderModels();
    const settings = await getProviderSettings();
    const modelId = selection.model ?? settings.model;
    const model = modelId ? models.find((item) => item.id === modelId) : undefined;
    if (selection.model && !model) throw new Error(`Unknown model: ${selection.model}`);
    if (
      selection.reasoningEffort &&
      model?.reasoningEfforts &&
      !model.reasoningEfforts.some((effort) => effort.id === selection.reasoningEffort)
    )
      throw new Error(`Unknown reasoning effort: ${selection.reasoningEffort}`);
    const seen = new Set<string>();
    for (const option of selection.options ?? []) {
      if (seen.has(option.id)) throw new Error(`Duplicate provider option: ${option.id}`);
      seen.add(option.id);
      const descriptor = model?.options?.find((item) => item.id === option.id);
      if (!descriptor) throw new Error(`Unknown provider option: ${option.id}`);
      if (
        (descriptor.type === "boolean" && typeof option.value !== "boolean") ||
        (descriptor.type === "select" &&
          (typeof option.value !== "string" ||
            !descriptor.choices.some((choice) => choice.id === option.value)))
      )
        throw new Error(`Invalid value for provider option: ${option.id}`);
    }
  };
  const fileListeners = new Set<(event: string, file: string) => void>();
  const watcher = watch(srcDir, {
    ignored: ["**/.git/**", "**/node_modules/**", "**/.skills/**"],
    ignoreInitial: true,
    usePolling: true,
    interval: 500,
  });
  watcher.on("all", (event, file) => {
    noteSearch.invalidate();
    for (const listener of fileListeners) listener(event, file);
  });

  const app = new Hono();
  app.onError((error, context) => context.json({ error: message(error) }, 400));
  app.get("/api/meta", (context) =>
    context.json({
      provider: config.provider.name,
      baseDir,
      srcDir,
      editor: {
        name: (config.editor ?? vscode()).name,
        label: (config.editor ?? vscode()).label,
        icon: (config.editor ?? vscode()).icon,
      },
      theme: config.theme ?? nawcLight(),
      plugins: config.plugins.map(({ name, nodes }) => ({ name, nodes })),
    }),
  );
  app.get("/api/notes", async (context) => context.json(await listNotes(srcDir)));
  app.get("/api/search", async (context) => {
    const query = context.req.query("q") ?? "";
    return context.json(await noteSearch.search(query));
  });
  app.get("/api/files", async (context) => context.json(await listEntries(srcDir)));
  app.get("/api/prompt/skills", async (context) =>
    context.json(
      (await getPromptSkills()).map(
        ({ name, source, displayName, shortDescription, description, scope }) => ({
          name,
          source,
          ...(displayName ? { displayName } : {}),
          ...(shortDescription ? { shortDescription } : {}),
          ...(description ? { description } : {}),
          ...(scope ? { scope } : {}),
        }),
      ),
    ),
  );
  app.get("/api/prompt/files", async (context) => {
    const query = (context.req.query("q") ?? "").trim().toLowerCase();
    return context.json(await listProjectPaths(baseDir, { query, limit: 50 }));
  });
  app.get("/api/prompt/models", async (context) => context.json(await getProviderModels()));
  app.get("/api/prompt/settings", async (context) => context.json(await getProviderSettings()));
  app.get("/api/prompt/commands", async (context) =>
    context.json(
      config.provider.listCommands
        ? await config.provider.listCommands({ cwd: baseDir })
        : (config.provider.slashCommands ?? []),
    ),
  );
  app.get("/api/agent/provider", (context) => context.json(agentManager.metadata()));
  app.get("/api/agent/threads", (context) => context.json(agentManager.listThreads()));
  app.get("/api/agent/threads/:id", (context) => {
    const thread = agentManager.getThread(context.req.param("id"));
    if (!thread) throw new Error("Unknown agent thread");
    return context.json(thread);
  });
  app.post("/api/agent/threads", async (context) => {
    const body = await context.req.json<{
      model?: string;
      reasoningEffort?: string;
      options?: readonly { readonly id: string; readonly value: string | boolean }[];
      mode?: string;
    }>();
    await validateAgentSelection(body);
    return context.json(await agentManager.createThread(body));
  });
  app.delete("/api/agent/threads/:id", async (context) => {
    await agentManager.deleteThread(context.req.param("id"));
    return context.json({ ok: true });
  });
  app.post("/api/agent/threads/:id/interrupt", async (context) => {
    await agentManager.interrupt(context.req.param("id"));
    return context.json({ ok: true });
  });
  app.post("/api/agent/threads/:id/requests/:requestId", async (context) => {
    const body = await context.req.json<{ decision: string }>();
    if (typeof body.decision !== "string" || !body.decision) throw new Error("Invalid decision");
    await agentManager.respondToRequest(
      context.req.param("id"),
      context.req.param("requestId"),
      body.decision,
    );
    return context.json({ ok: true });
  });
  app.post("/api/agent/threads/:id/turns", async (context) => {
    const body = await context.req.json<{
      prompt: string;
      note?: string;
      noteContent?: string;
      model?: string;
      reasoningEffort?: string;
      options?: readonly { readonly id: string; readonly value: string | boolean }[];
      mode?: string;
      attachments?: readonly {
        readonly type: "image";
        readonly id: string;
        readonly name: string;
        readonly mimeType: string;
        readonly sizeBytes: number;
        readonly dataUrl: string;
      }[];
      references?: readonly (
        | { readonly type: "file"; readonly path: string }
        | { readonly type: "skill"; readonly name: string }
        | {
            readonly type: "diagnostic";
            readonly message: string;
            readonly file?: string;
            readonly line?: number;
          }
      )[];
    }>();
    if (typeof body.prompt !== "string" || !body.prompt.trim())
      throw new Error("Prompt is required");
    if ((body.references?.length ?? 0) > 50) throw new Error("Too many agent references");
    const attachments = validateAgentAttachments(body.attachments);
    await validateAgentSelection(body);
    const availableSkills = new Map(
      (await getPromptSkills()).map((skill) => [skill.name, skill.path]),
    );
    const references: PromptReference[] = [];
    if (body.note) {
      const content = body.noteContent ?? (await readNote(srcDir, body.note));
      references.push({ type: "note", path: body.note, content });
    }
    for (const reference of body.references ?? []) {
      if (reference.type === "file") {
        if (!(await isProjectPath(baseDir, reference.path)))
          throw new Error(`Unknown or ignored file reference: ${reference.path}`);
        references.push(reference);
      } else if (reference.type === "skill") {
        const skillPath = availableSkills.get(reference.name);
        if (!skillPath) throw new Error(`Unknown skill reference: ${reference.name}`);
        references.push({ ...reference, path: skillPath });
      } else if (reference.type === "diagnostic" && reference.message) {
        references.push(reference);
      } else throw new Error("Invalid agent reference");
    }
    return streamSSE(context, async (stream) => {
      for await (const event of agentManager.sendTurn({
        threadId: context.req.param("id"),
        prompt: body.prompt,
        references,
        attachments,
        model: body.model,
        reasoningEffort: body.reasoningEffort,
        options: body.options,
        mode: body.mode,
      }))
        await stream.writeSSE({ data: JSON.stringify(event), event: event.type });
    });
  });
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
    noteSearch.invalidate();
    return context.json({ ok: true });
  });
  app.delete("/api/note", async (context) => {
    await deleteNote(srcDir, context.req.query("path") ?? "");
    noteSearch.invalidate();
    return context.json({ ok: true });
  });
  app.post("/api/note/rename", async (context) => {
    const body = await context.req.json<{ from: string; to: string }>();
    await renameNote(srcDir, body.from, body.to);
    noteSearch.invalidate();
    return context.json({ ok: true });
  });
  app.post("/api/folder", async (context) => {
    const { path: folder } = await context.req.json<{ path: string }>();
    await createFolder(srcDir, folder);
    noteSearch.invalidate();
    return context.json({ ok: true });
  });
  app.delete("/api/entry", async (context) => {
    await deleteEntry(srcDir, context.req.query("path") ?? "");
    noteSearch.invalidate();
    return context.json({ ok: true });
  });
  app.post("/api/entry/rename", async (context) => {
    const body = await context.req.json<{ from: string; to: string }>();
    await renameEntry(srcDir, body.from, body.to);
    noteSearch.invalidate();
    return context.json({ ok: true });
  });
  app.post("/api/entry/move", async (context) => {
    const body = await context.req.json<{ from: string; to: string; replace?: boolean }>();
    await moveEntry(srcDir, body.from, body.to, body.replace);
    noteSearch.invalidate();
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
    const body = await context.req.json<{
      prompt: string;
      model?: string;
      reasoningEffort?: string;
      mode?: "default" | "plan";
      references?: readonly (
        | { readonly type: "file"; readonly path: string }
        | { readonly type: "skill"; readonly name: string }
      )[];
    }>();
    if (typeof body.prompt !== "string") throw new Error("Prompt must be a string");
    if (body.model !== undefined && typeof body.model !== "string")
      throw new Error("Model must be a string");
    if (body.reasoningEffort !== undefined && typeof body.reasoningEffort !== "string")
      throw new Error("Reasoning effort must be a string");
    if (body.mode !== undefined && body.mode !== "default" && body.mode !== "plan")
      throw new Error("Invalid prompt mode");
    if ((body.references?.length ?? 0) > 50) throw new Error("Too many prompt references");
    if (body.model && config.provider.listModels) {
      const models = await getProviderModels();
      if (!models.some((model) => model.id === body.model))
        throw new Error(`Unknown model: ${body.model}`);
    }
    const availableSkills = new Map(
      (await getPromptSkills()).map((skill) => [skill.name, skill.path]),
    );
    const references: PromptReference[] = [];
    for (const reference of body.references ?? []) {
      if (reference.type === "file") {
        if (!(await isProjectPath(baseDir, reference.path)))
          throw new Error(`Unknown or ignored file reference: ${reference.path}`);
        references.push({ type: "file", path: reference.path });
      } else if (reference.type === "skill") {
        const skillPath = availableSkills.get(reference.name);
        if (!skillPath) {
          throw new Error(`Unknown skill reference: ${reference.name}`);
        }
        references.push({
          type: "skill",
          name: reference.name,
          path: skillPath,
        });
      } else {
        throw new Error("Invalid prompt reference");
      }
    }
    const referenceContext = references.length
      ? `\n\nNAWC references selected by the user:\n${references
          .map((reference) =>
            reference.type === "file"
              ? `- File: ${JSON.stringify(reference.path)} (relative to the working directory)`
              : reference.type === "skill"
                ? `- Skill: ${JSON.stringify(`$${reference.name}`)} (${JSON.stringify(reference.path)}); read this SKILL.md before acting`
                : reference.type === "note"
                  ? `- Note: ${JSON.stringify(reference.path)}`
                  : `- Diagnostic: ${reference.message}`,
          )
          .join("\n")}`
      : "";
    return streamSSE(context, async (stream) => {
      if (!config.provider.prompt)
        throw new Error("Provider does not support the legacy prompt API");
      for await (const event of config.provider.prompt({
        prompt: body.prompt + referenceContext,
        cwd: baseDir,
        skillsDir,
        references,
        model: body.model,
        reasoningEffort: body.reasoningEffort,
        mode: body.mode,
      }))
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
      ws: false,
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
      if (run.script) child.write(run.script);
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
      await agentManager.close();
      runSockets.close();
      await watcher.close();
      await vite.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
