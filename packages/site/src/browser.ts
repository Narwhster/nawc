import type { StaticSiteConfig, StaticAgentHistoryEntry } from "./index.ts";

export type StaticNotebookData = {
  readonly notes: Readonly<Record<string, string>>;
  readonly sources: Readonly<Record<string, string>>;
  readonly theme: {
    readonly name: string;
    readonly appearance: "light" | "dark";
    readonly variables: Readonly<Record<`--${string}`, string>>;
  };
  readonly plugins: readonly {
    readonly name: string;
    readonly nodes?: readonly {
      readonly name: string;
      readonly tag: string;
      readonly description: string;
    }[];
  }[];
};

type RuntimeInput = StaticNotebookData & {
  readonly agent: StaticSiteConfig;
};

type AgentRequest = {
  readonly id: string;
  readonly turnId: string;
  readonly kind: string;
  readonly title: string;
  readonly question: string;
  readonly label?: string;
  readonly choices: readonly string[];
  readonly allowCustom: boolean;
  status: "pending" | "resolved";
  decision?: string;
};

type AgentMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly turnId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly streaming: false;
  readonly references?: readonly { readonly type: "note"; readonly path: string }[];
};

type AgentTurn = {
  readonly id: string;
  status: "running" | "completed" | "interrupted";
  readonly createdAt: string;
  updatedAt: string;
};

type AgentActivity = {
  readonly id: string;
  readonly turnId: string;
  readonly createdAt: string;
  readonly tool: string;
  title: string;
  status: "running" | "completed" | "failed" | "declined";
  output?: string;
};

type AgentThread = {
  readonly id: string;
  readonly provider: "nawc-agent";
  readonly createdAt: string;
  updatedAt: string;
  status: "idle" | "running";
  readonly turns: AgentTurn[];
  readonly messages: AgentMessage[];
  activities: AgentActivity[];
  readonly requests: AgentRequest[];
  readonly warnings: never[];
  readonly unknownEvents: never[];
  readonly attachedReferenceKeys: never[];
  prompt?: string;
  title?: string;
  note?: string;
  history: StaticAgentHistoryEntry[];
};

type SourceSelection = {
  readonly file: string;
  readonly source?: string;
  readonly syntax?: string;
  readonly name?: string;
  readonly type?: string;
  readonly params?: string;
};

declare global {
  interface Window {
    __nawcBrowserRun?: (
      selection: SourceSelection,
      write: (output: string) => void,
    ) => Promise<void>;
  }
}

const timestamp = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function cleanPath(value: string): string {
  const path = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!path || path.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error(`Invalid path: ${value}`);
  return path;
}

function dirname(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function response(value: unknown, status = 200): Response {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return new Response(text, {
    status,
    headers: {
      "content-type": typeof value === "string" ? "text/plain; charset=utf-8" : "application/json",
    },
  });
}

function errorResponse(error: unknown): Response {
  return response({ error: error instanceof Error ? error.message : String(error) }, 400);
}

function textFromHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  return document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function printable(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export async function runStaticSource(
  source: string,
  syntax: string | undefined,
  write: (data: string) => void,
): Promise<void> {
  const normalizedSyntax = syntax?.toLowerCase();
  if (
    normalizedSyntax &&
    !["typescript", "ts", "tsx", "javascript", "js", "jsx"].includes(normalizedSyntax)
  )
    throw new Error(`Syntax ${syntax} cannot run in a static notebook`);
  const compiled =
    normalizedSyntax && ["typescript", "ts", "tsx"].includes(normalizedSyntax)
      ? (await import("sucrase")).transform(source, {
          transforms: ["typescript", "jsx"],
          production: true,
        }).code
      : source;
  const runtimeConsole = Object.fromEntries(
    ["log", "info", "warn", "error"].map((method) => [
      method,
      (...values: unknown[]) => write(`${values.map(printable).join(" ")}\n`),
    ]),
  ) as Pick<Console, "log" | "info" | "warn" | "error">;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...parameters: string[]
  ) => (...args: unknown[]) => Promise<void>;
  await new AsyncFunction("console", compiled)(runtimeConsole);
}

function initialRoute(notes: ReadonlyMap<string, string>, homeNote?: string): void {
  if (location.hash || location.pathname.includes("/note/")) return;
  const preferred =
    homeNote && notes.has(homeNote)
      ? homeNote
      : notes.has("index.html")
        ? "index.html"
        : [...notes.keys()].sort()[0];
  if (!preferred) return;
  const encoded = preferred.split("/").map(encodeURIComponent).join("/");
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}#/note/${encoded}`,
  );
}

export function installStaticRuntime(input: RuntimeInput): void {
  const notes = new Map(Object.entries(input.notes));
  const sources = new Map(Object.entries(input.sources));
  const folders = new Set<string>();
  const threads = new Map<string, AgentThread>();
  const turnControllers = new Map<string, AbortController>();
  const eventSources = new Set<StaticEventSource>();
  const originalFetch = window.fetch.bind(window);

  const deriveFolders = () => {
    folders.clear();
    for (const note of notes.keys()) {
      let parent = dirname(note);
      while (parent) {
        folders.add(parent);
        parent = dirname(parent);
      }
    }
  };
  deriveFolders();
  initialRoute(notes, input.agent.homeNote);

  const emitFile = (event: string, file: string) => {
    const data = JSON.stringify({ event, file });
    for (const source of eventSources) source.emitMessage(data);
  };
  const emitAgent = (threadId: string, thread: AgentThread | null) => {
    const data = JSON.stringify({ event: "agent", threadId, thread });
    for (const source of eventSources) source.emitAgent(data);
  };
  const matchingFiles = () => {
    const matcher = input.agent.files.match;
    return [...notes].flatMap(([path, content]) => {
      matcher.lastIndex = 0;
      return matcher.test(path) ? [{ path, content }] : [];
    });
  };
  const cancellableDelay = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done);
    });

  const advance = async (thread: AgentThread, turn: AgentTurn, signal: AbortSignal) => {
    if (!thread.prompt) throw new Error("Missing FAQ prompt");
    const result = input.agent.faq({
      prompt: thread.prompt,
      files: matchingFiles(),
      history: thread.history,
      note: thread.note,
    });
    const node = result.node;
    if (node.type === "question" && node.title) {
      thread.title = node.title;
    }
    const now = timestamp();
    if (signal.aborted) return;
    if (node.type === "question") {
      thread.messages.push({
        id: id(),
        role: "assistant",
        text: node.question,
        turnId: turn.id,
        createdAt: now,
        updatedAt: now,
        streaming: false,
      });
      thread.requests.push({
        id: id(),
        turnId: turn.id,
        kind: "question",
        title: node.title ?? node.question,
        question: node.question,
        label: node.label,
        choices: node.answers.map((answer) => answer.label),
        allowCustom: node.allowCustom ?? false,
        status: "pending",
      });
      thread.status = "running";
    } else if (node.type === "sequence") {
      for (const step of node.steps) {
        if (signal.aborted) return;
        const stepNow = timestamp();
        if (step.type === "tool_call") {
          const activity: AgentActivity = {
            id: id(),
            turnId: turn.id,
            createdAt: stepNow,
            tool: step.tool,
            title: step.title,
            status: "running",
          };
          thread.activities.push(activity);
          emitAgent(thread.id, thread);
          if (step.duration && step.duration > 0) {
            await cancellableDelay(step.duration, signal);
          }
          if (signal.aborted) return;
          activity.status = "completed";
          emitAgent(thread.id, thread);
        } else if (step.type === "delay") {
          await cancellableDelay(step.ms, signal);
        } else if (step.type === "answer") {
          thread.messages.push({
            id: id(),
            role: "assistant",
            text: step.text,
            turnId: turn.id,
            createdAt: stepNow,
            updatedAt: stepNow,
            streaming: false,
          });
          emitAgent(thread.id, thread);
        }
      }
      if (signal.aborted) return;
      turn.status = "completed";
      turn.updatedAt = timestamp();
      thread.status = "idle";
    } else {
      thread.messages.push({
        id: id(),
        role: "assistant",
        text: node.text,
        turnId: turn.id,
        createdAt: now,
        updatedAt: now,
        streaming: false,
      });
      turn.status = "completed";
      turn.updatedAt = now;
      thread.status = "idle";
    }
    if (result.sideEffect) result.sideEffect();
    thread.updatedAt = timestamp();
    emitAgent(thread.id, thread);
  };

  class StaticEventSource extends EventTarget {
    readonly url: string;
    readonly withCredentials = false;
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    constructor(url: string | URL) {
      super();
      this.url = String(url);
      eventSources.add(this);
      queueMicrotask(() => {
        if (!eventSources.has(this)) return;
        this.readyState = 1;
        const open = new Event("open");
        this.onopen?.(open);
        this.dispatchEvent(open);
        this.emitMessage(JSON.stringify({ event: "ready" }));
      });
    }

    close() {
      this.readyState = 2;
      eventSources.delete(this);
    }

    emitMessage(data: string) {
      const event = new MessageEvent<string>("message", { data });
      this.onmessage?.(event);
      this.dispatchEvent(event);
    }

    emitAgent(data: string) {
      this.dispatchEvent(new MessageEvent<string>("agent", { data }));
    }
  }

  Object.assign(StaticEventSource, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
  window.EventSource = StaticEventSource as unknown as typeof EventSource;

  window.fetch = async (resource: RequestInfo | URL, init?: RequestInit) => {
    const request = resource instanceof Request ? resource : undefined;
    const href =
      typeof resource === "string"
        ? resource
        : resource instanceof URL
          ? resource.href
          : resource.url;
    const url = new URL(href, location.href);
    if (!url.pathname.startsWith("/api/")) return originalFetch(resource, init);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const body = async <T>() => {
      const text =
        typeof init?.body === "string" ? init.body : request ? await request.text() : "{}";
      return JSON.parse(text) as T;
    };
    try {
      if (url.pathname === "/api/meta")
        return response({
          provider: "nawc-agent",
          baseDir: "",
          srcDir: "src",
          editor: { name: "browser", label: "browser" },
          theme: input.theme,
          plugins: input.plugins,
        });
      if (url.pathname === "/api/notes")
        return response([...notes.keys()].sort((left, right) => left.localeCompare(right)));
      if (url.pathname === "/api/files") {
        const entries = [
          ...[...folders].map((path) => ({ path, type: "folder" as const })),
          ...[...notes.keys()].map((path) => ({ path, type: "file" as const })),
        ].sort((left, right) => left.path.localeCompare(right.path));
        return response(entries);
      }
      if (url.pathname === "/api/search") {
        const terms = (url.searchParams.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        return response(
          [...notes]
            .flatMap(([path, content]) => {
              const text = textFromHtml(content);
              const haystack = `${path} ${text}`.toLowerCase();
              return terms.every((term) => haystack.includes(term))
                ? [
                    {
                      path,
                      title:
                        path
                          .split("/")
                          .at(-1)
                          ?.replace(/\.html$/, "") ?? path,
                      snippet: text.slice(0, 150),
                      terms,
                    },
                  ]
                : [];
            })
            .slice(0, 30),
        );
      }
      if (url.pathname === "/api/note" && method === "GET") {
        const path = cleanPath(url.searchParams.get("path") ?? "");
        const content = notes.get(path);
        if (content === undefined) throw new Error(`Note not found: ${path}`);
        return response(content);
      }
      if (url.pathname === "/api/note" && method === "PUT") {
        const value = await body<{ path: string; content: string }>();
        const path = cleanPath(value.path);
        notes.set(path, value.content);
        deriveFolders();
        emitFile("change", path);
        return response({ ok: true });
      }
      if (url.pathname === "/api/folder" && method === "POST") {
        const value = await body<{ path: string }>();
        folders.add(cleanPath(value.path));
        emitFile("addDir", value.path);
        return response({ ok: true });
      }
      if (url.pathname === "/api/entry" && method === "DELETE") {
        const path = cleanPath(url.searchParams.get("path") ?? "");
        notes.delete(path);
        for (const note of notes.keys()) if (note.startsWith(`${path}/`)) notes.delete(note);
        deriveFolders();
        emitFile("unlink", path);
        return response({ ok: true });
      }
      if (
        (url.pathname === "/api/entry/rename" || url.pathname === "/api/entry/move") &&
        method === "POST"
      ) {
        const value = await body<{ from: string; to: string; replace?: boolean }>();
        const from = cleanPath(value.from);
        const to = cleanPath(value.to);
        const affected = [...notes].filter(
          ([path]) => path === from || path.startsWith(`${from}/`),
        );
        if (!affected.length && !folders.has(from)) throw new Error(`Entry not found: ${from}`);
        if (
          !value.replace &&
          [...notes.keys()].some((path) => path === to || path.startsWith(`${to}/`))
        )
          throw new Error(`Entry already exists: ${to}`);
        if (value.replace) {
          notes.delete(to);
          for (const path of notes.keys()) if (path.startsWith(`${to}/`)) notes.delete(path);
        }
        for (const [path, content] of affected) {
          notes.delete(path);
          notes.set(`${to}${path.slice(from.length)}`, content);
        }
        deriveFolders();
        emitFile("rename", to);
        return response({ ok: true });
      }
      if (url.pathname === "/api/source" && method === "POST") {
        const selection = await body<SourceSelection>();
        const code = selection.source ?? sources.get(cleanPath(selection.file));
        if (code === undefined)
          throw new Error(`Source not included in this site: ${selection.file}`);
        return response({
          ...selection,
          code,
          startLine: 1,
          endLine: code.split("\n").length,
        });
      }
      if (url.pathname === "/api/editor/open")
        throw new Error("This static notebook has no external editor");
      if (url.pathname === "/api/prompt/files") return response([]);
      if (url.pathname === "/api/prompt/skills") return response([]);
      if (url.pathname === "/api/prompt/models")
        return response([{ id: "nawc-ai", name: "nawc-ai" }]);
      if (url.pathname === "/api/prompt/settings") return response({});
      if (url.pathname === "/api/prompt/commands") return response([]);
      if (url.pathname === "/api/agent/provider")
        return response({
          name: "nawc-agent",
          label: "Notebook guide",
          capabilities: ["requests"],
          modes: [],
        });
      if (url.pathname === "/api/agent/threads" && method === "GET")
        return response(
          [...threads.values()].sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
          ),
        );
      if (url.pathname === "/api/agent/threads" && method === "POST") {
        const now = timestamp();
        const thread: AgentThread = {
          id: id(),
          provider: "nawc-agent",
          createdAt: now,
          updatedAt: now,
          status: "idle",
          turns: [],
          messages: [],
          activities: [],
          requests: [],
          warnings: [],
          unknownEvents: [],
          attachedReferenceKeys: [],
          history: [],
        };
        threads.set(thread.id, thread);
        emitAgent(thread.id, thread);
        return response(thread);
      }
      const threadMatch = url.pathname.match(/^\/api\/agent\/threads\/([^/]+)$/);
      if (threadMatch && method === "DELETE") {
        const threadId = decodeURIComponent(threadMatch[1] ?? "");
        threads.delete(threadId);
        emitAgent(threadId, null);
        return response({ ok: true });
      }
      const interruptMatch = url.pathname.match(/^\/api\/agent\/threads\/([^/]+)\/interrupt$/);
      if (interruptMatch && method === "POST") {
        const threadId = decodeURIComponent(interruptMatch[1] ?? "");
        const thread = threads.get(threadId);
        turnControllers.get(threadId)?.abort();
        turnControllers.delete(threadId);
        if (thread && thread.status === "running") {
          const turn = thread.turns.findLast((item) => item.status === "running");
          if (turn) {
            turn.status = "interrupted";
            turn.updatedAt = timestamp();
          }
          thread.status = "idle";
          thread.updatedAt = timestamp();
          emitAgent(threadId, thread);
        }
        return response({ ok: true });
      }
      const turnMatch = url.pathname.match(/^\/api\/agent\/threads\/([^/]+)\/turns$/);
      if (turnMatch && method === "POST") {
        const threadId = decodeURIComponent(turnMatch[1] ?? "");
        const thread = threads.get(threadId);
        if (!thread) throw new Error("Unknown agent thread");
        const value = await body<{ prompt: string; note?: string }>();
        const now = timestamp();
        const turn: AgentTurn = {
          id: id(),
          status: "running",
          createdAt: now,
          updatedAt: now,
        };
        thread.prompt = value.prompt;
        thread.note = value.note;
        thread.history = [];
        thread.turns.push(turn);
        thread.messages.push({
          id: id(),
          role: "user",
          text: value.prompt,
          turnId: turn.id,
          createdAt: now,
          updatedAt: now,
          streaming: false,
          references: value.note ? [{ type: "note", path: value.note }] : undefined,
        });
        const controller = new AbortController();
        turnControllers.set(threadId, controller);
        if (request?.signal) {
          if (request.signal.aborted) controller.abort();
          else request.signal.addEventListener("abort", () => controller.abort());
        }
        try {
          await advance(thread, turn, controller.signal);
        } finally {
          turnControllers.delete(threadId);
        }
        return response("");
      }
      const requestMatch = url.pathname.match(
        /^\/api\/agent\/threads\/([^/]+)\/requests\/([^/]+)$/,
      );
      if (requestMatch && method === "POST") {
        const threadId = decodeURIComponent(requestMatch[1] ?? "");
        const thread = threads.get(threadId);
        if (!thread) throw new Error("Unknown agent thread");
        const agentRequest = thread.requests.find(
          (item) => item.id === decodeURIComponent(requestMatch[2] ?? ""),
        );
        if (!agentRequest || agentRequest.status !== "pending")
          throw new Error("Unknown agent request");
        const value = await body<{ decision: string }>();
        if (!agentRequest.allowCustom && !agentRequest.choices.includes(value.decision))
          throw new Error("Invalid FAQ answer");
        agentRequest.status = "resolved";
        agentRequest.decision = value.decision;
        thread.history.push({
          label: agentRequest.label,
          question: agentRequest.question,
          chosenAnswer: value.decision,
        });
        const turn = thread.turns.find((item) => item.id === agentRequest.turnId);
        if (!turn) throw new Error("Unknown agent turn");
        const controller = new AbortController();
        turnControllers.set(threadId, controller);
        if (request?.signal) {
          if (request.signal.aborted) controller.abort();
          else request.signal.addEventListener("abort", () => controller.abort());
        }
        try {
          await advance(thread, turn, controller.signal);
        } finally {
          turnControllers.delete(threadId);
        }
        return response({ ok: true });
      }
      throw new Error(`Static notebook API does not support ${method} ${url.pathname}`);
    } catch (error) {
      return errorResponse(error);
    }
  };

  window.__nawcBrowserRun = async (selection, write) => {
    const source = selection.source || sources.get(cleanPath(selection.file));
    if (source === undefined)
      throw new Error(`Source not included in this site: ${selection.file}`);
    await runStaticSource(source, selection.syntax, write);
  };
}
