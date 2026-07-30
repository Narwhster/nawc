import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  NawcProvider,
  NawcProviderModel,
  NawcProviderOption,
  NawcProviderOptionSelection,
  NawcProviderReasoningEffort,
  NawcProviderRequestChoice,
  NawcProviderSettings,
  NawcProviderSession,
  NawcProviderTurnInput,
  ProviderEvent,
} from "@nawc/config";

const trackedChildPids = new Set<number>();
let exitHandlerInstalled = false;

function trackChildPid(pid: number | undefined): void {
  if (pid === undefined) return;
  trackedChildPids.add(pid);
  if (!exitHandlerInstalled) {
    exitHandlerInstalled = true;
    process.on("exit", () => {
      for (const pid of trackedChildPids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone or no permission; nothing to do.
        }
      }
    });
  }
}

function untrackChildPid(pid: number | undefined): void {
  if (pid !== undefined) trackedChildPids.delete(pid);
}

type JsonObject = Record<string, unknown>;
type JsonRpcId = string | number;

type JsonRpcMessage = {
  readonly jsonrpc?: string;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
};

type CursorConfigOption = {
  readonly id: string;
  readonly name?: string;
  readonly category?: string;
  readonly type?: string;
  readonly currentValue?: string | boolean;
  readonly options?: readonly CursorConfigChoice[];
};

type CursorConfigChoice = {
  readonly value: string;
  readonly name: string;
};

type PendingRequest = {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params: unknown;
};

type CursorRequestEvent = {
  readonly kind: "request";
  readonly request: PendingRequest;
};

type CursorPromptEvent =
  | { readonly kind: "prompt-completed"; readonly result: unknown }
  | { readonly kind: "prompt-failed"; readonly error: Error };

type CursorQueueItem = ProviderEvent | CursorRequestEvent | CursorPromptEvent;

const DEFAULT_CURSOR_EXECUTABLES = ["agent", "cursor-agent"] as const;
const STARTUP_TIMEOUT_MS = 20_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}

function errorFromRpc(message: JsonRpcMessage, fallback: string): Error {
  const detail = message.error?.message;
  return new Error(typeof detail === "string" && detail ? detail : fallback);
}

function isMissingExecutable(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function parseJsonRpcLine(line: string): JsonRpcMessage | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

class AsyncQueue<T> {
  readonly #items: T[] = [];
  readonly #waiters = new Set<{
    readonly resolve: (value: T) => void;
    readonly reject: (error: Error) => void;
    readonly signal?: AbortSignal;
    readonly onAbort?: () => void;
  }>();

  push(item: T): void {
    const waiter = this.#waiters.values().next().value as
      | {
          readonly resolve: (value: T) => void;
          readonly reject: (error: Error) => void;
          readonly signal?: AbortSignal;
          readonly onAbort?: () => void;
        }
      | undefined;
    if (!waiter) {
      this.#items.push(item);
      return;
    }
    this.#waiters.delete(waiter);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.resolve(item);
  }

  next(signal?: AbortSignal): Promise<T> {
    const item = this.#items.shift();
    if (item !== undefined) return Promise.resolve(item);
    if (signal?.aborted) return Promise.reject(new Error("Operation aborted"));
    return new Promise<T>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        onAbort: undefined as (() => void) | undefined,
      };
      if (signal) {
        waiter.onAbort = () => {
          this.#waiters.delete(waiter);
          reject(new Error("Operation aborted"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.#waiters.add(waiter);
    });
  }

  drain(): T[] {
    return this.#items.splice(0);
  }
}

class CursorAcpProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<
    string,
    { readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }
  >();
  readonly #serverRequests = new Map<string, PendingRequest>();
  readonly #queue = new AsyncQueue<CursorQueueItem>();
  #nextId = 1;
  #buffer = "";
  #closed = false;
  #onServerRequest: ((request: PendingRequest) => void) | undefined;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.#child = child;
    trackChildPid(child.pid);
    child.once("close", () => {
      untrackChildPid(child.pid);
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#consume(chunk));
    child.on("error", (error) => this.#fail(error));
    child.on("close", (code) => {
      if (!this.#closed)
        this.#fail(new Error(`Cursor Agent exited with code ${code ?? "unknown"}`));
    });
  }

  static async start(input: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
  }): Promise<CursorAcpProcess> {
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    return new CursorAcpProcess(child);
  }

  setServerRequestHandler(handler: (request: PendingRequest) => void): void {
    this.#onServerRequest = handler;
  }

  async request(method: string, params: unknown, timeoutMs = STARTUP_TIMEOUT_MS): Promise<unknown> {
    if (this.#closed) throw new Error("Cursor Agent connection is closed");
    const id = this.#nextId++;
    const key = requestKey(id);
    const response = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(key, { resolve, reject });
    });
    this.#write({ jsonrpc: "2.0", id, method, params });
    if (timeoutMs <= 0) return await response;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        response,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Timed out waiting for Cursor ${method}`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      this.#pending.delete(key);
    }
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.#serverRequests.delete(requestKey(id));
    this.#write({ jsonrpc: "2.0", id, result });
  }

  respondError(id: JsonRpcId, message: string): void {
    this.#serverRequests.delete(requestKey(id));
    this.#write({ jsonrpc: "2.0", id, error: { code: -32601, message } });
  }

  rememberServerRequest(request: PendingRequest): void {
    this.#serverRequests.set(requestKey(request.id), request);
  }

  getServerRequest(id: string): PendingRequest | undefined {
    return this.#serverRequests.get(id);
  }

  next(signal?: AbortSignal): Promise<CursorQueueItem> {
    return this.#queue.next(signal);
  }

  push(item: CursorQueueItem): void {
    this.#queue.push(item);
  }

  drain(): CursorQueueItem[] {
    return this.#queue.drain();
  }

  cancel(): void {
    this.#write({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: this.sessionId },
    });
  }

  sessionId = "";

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(new Error("Cursor Agent closed"));
    this.#pending.clear();
    this.#child.kill("SIGTERM");
  }

  #write(message: JsonObject): void {
    if (!this.#closed) this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #consume(chunk: string): void {
    this.#buffer += chunk;
    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = parseJsonRpcLine(line);
      if (!message) continue;
      this.#handle(message);
    }
  }

  #handle(message: JsonRpcMessage): void {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const id =
        typeof message.id === "string" || typeof message.id === "number" ? message.id : undefined;
      const pending = id === undefined ? undefined : this.#pending.get(requestKey(id));
      if (!pending) return;
      if (message.error !== undefined)
        pending.reject(errorFromRpc(message, "Cursor Agent request failed"));
      else pending.resolve(message.result);
      return;
    }
    if (
      message.id !== undefined &&
      typeof message.method === "string" &&
      (typeof message.id === "string" || typeof message.id === "number")
    ) {
      const request = { id: message.id, method: message.method, params: message.params };
      this.rememberServerRequest(request);
      this.#onServerRequest?.(request);
      return;
    }
    if (typeof message.method === "string")
      this.#queue.push(mapCursorNotification(message.method, message.params));
  }

  #fail(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

function jsonText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function mapCursorNotification(method: string, params: unknown): ProviderEvent {
  if (method !== "session/update" || !isRecord(params) || !isRecord(params.update)) {
    return { type: "unknown", sourceType: method, payload: params };
  }
  const update = params.update;
  const updateType = update.sessionUpdate;
  if (updateType === "agent_message_chunk" && isRecord(update.content)) {
    if (update.content.type === "text" && typeof update.content.text === "string") {
      return {
        type: "message.delta",
        text: update.content.text,
        ...(typeof update.messageId === "string" ? { itemId: update.messageId } : {}),
      };
    }
  }
  if (updateType === "tool_call" || updateType === "tool_call_update") {
    const status =
      update.status === "in_progress"
        ? "running"
        : update.status === "failed"
          ? "failed"
          : update.status === "completed"
            ? "completed"
            : "running";
    return {
      type: updateType === "tool_call" ? "tool.started" : "tool.updated",
      tool: typeof update.kind === "string" ? update.kind : "tool",
      title: typeof update.title === "string" ? update.title : "Cursor tool",
      status,
      ...(typeof update.toolCallId === "string" ? { itemId: update.toolCallId } : {}),
      ...(update.rawOutput !== undefined ? { output: jsonText(update.rawOutput) } : {}),
    };
  }
  if (updateType === "plan" && Array.isArray(update.entries)) {
    const markdown = update.entries
      .flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.content !== "string") return [];
        const marker = entry.status === "completed" ? "x" : " ";
        return [`- [${marker}] ${entry.content}`];
      })
      .join("\n");
    if (markdown) return { type: "plan.updated", markdown };
  }
  return { type: "unknown", sourceType: `session.update.${String(updateType)}`, payload: params };
}

function mapCursorExtensionRequest(request: PendingRequest): ProviderEvent | undefined {
  const params = isRecord(request.params) ? request.params : {};
  if (request.method === "cursor/create_plan" && typeof params.plan === "string") {
    return { type: "plan.updated", markdown: params.plan };
  }
  if (request.method === "cursor/update_todos" && Array.isArray(params.todos)) {
    const markdown = params.todos
      .flatMap((todo) => {
        if (!isRecord(todo)) return [];
        const text =
          typeof todo.content === "string"
            ? todo.content
            : typeof todo.title === "string"
              ? todo.title
              : undefined;
        if (!text) return [];
        return [`- [${todo.status === "completed" ? "x" : " "}] ${text}`];
      })
      .join("\n");
    return markdown ? { type: "plan.updated", markdown } : undefined;
  }
  return undefined;
}

function configOptions(value: unknown): readonly CursorConfigOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): CursorConfigOption[] => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    const choices = Array.isArray(entry.options)
      ? entry.options.flatMap((choice): CursorConfigChoice[] =>
          isRecord(choice) && typeof choice.value === "string" && typeof choice.name === "string"
            ? [{ value: choice.value, name: choice.name }]
            : [],
        )
      : [];
    return [
      {
        id: entry.id,
        ...(typeof entry.name === "string" ? { name: entry.name } : {}),
        ...(typeof entry.category === "string" ? { category: entry.category } : {}),
        ...(typeof entry.type === "string" ? { type: entry.type } : {}),
        ...(typeof entry.currentValue === "string" || typeof entry.currentValue === "boolean"
          ? { currentValue: entry.currentValue }
          : {}),
        ...(choices.length ? { options: choices } : {}),
      },
    ];
  });
}

function selectChoices(option: CursorConfigOption | undefined): readonly CursorConfigChoice[] {
  return option?.options ?? [];
}

function normalized(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
}

function findOption(
  options: readonly CursorConfigOption[],
  ids: readonly string[],
): CursorConfigOption | undefined {
  return options.find((option) => {
    const values = [option.id, option.name ?? ""].map(normalized);
    return ids.some((id) => values.includes(normalized(id)));
  });
}

function findReasoningOption(
  options: readonly CursorConfigOption[],
): CursorConfigOption | undefined {
  return options.find((option) => {
    const text = `${option.id} ${option.name ?? ""}`.toLowerCase();
    return (text.includes("reason") || text.includes("effort")) && selectChoices(option).length > 0;
  });
}

function modelOptions(options: readonly CursorConfigOption[]): {
  readonly reasoningEfforts?: readonly NawcProviderReasoningEffort[];
  readonly defaultReasoningEffort?: string;
  readonly options?: readonly NawcProviderOption[];
} {
  const reasoning = findReasoningOption(options);
  const reasoningEfforts = reasoning
    ? selectChoices(reasoning).map((choice) => ({ id: choice.value, description: choice.name }))
    : [];
  const descriptors: NawcProviderOption[] = [];
  const descriptorDefinitions = [
    {
      ids: ["context", "context_size", "context-window"],
      id: "contextWindow",
      label: "Context window",
    },
    { ids: ["fast", "fast-mode"], id: "fastMode", label: "Fast mode" },
    { ids: ["thinking"], id: "thinking", label: "Thinking" },
  ] as const;
  for (const definition of descriptorDefinitions) {
    const option = findOption(options, definition.ids);
    if (!option) continue;
    if (option.type === "boolean") {
      descriptors.push({ id: definition.id, label: definition.label, type: "boolean" });
    } else if (selectChoices(option).length) {
      descriptors.push({
        id: definition.id,
        label: option.name ?? definition.label,
        type: "select",
        choices: selectChoices(option).map((choice) => ({ id: choice.value, label: choice.name })),
        ...(typeof option.currentValue === "string" ? { defaultValue: option.currentValue } : {}),
      });
    }
  }
  return {
    ...(reasoningEfforts.length ? { reasoningEfforts } : {}),
    ...(typeof reasoning?.currentValue === "string"
      ? { defaultReasoningEffort: reasoning.currentValue }
      : {}),
    ...(descriptors.length ? { options: descriptors } : {}),
  };
}

export function parseCursorModelsResponse(value: unknown): readonly NawcProviderModel[] {
  if (!isRecord(value) || !Array.isArray(value.models)) return [];
  return value.models.flatMap((entry): NawcProviderModel[] => {
    if (!isRecord(entry) || typeof entry.value !== "string" || typeof entry.name !== "string")
      return [];
    const details = modelOptions(configOptions(entry.configOptions));
    return [{ id: entry.value, name: entry.name, ...details }];
  });
}

export function parseCursorEvent(method: string, params: unknown): ProviderEvent {
  return mapCursorNotification(method, params);
}

export type CursorOptions = {
  readonly executable?: string;
  readonly apiEndpoint?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
};

type CursorSession = NawcProviderSession & {
  readonly acp: CursorAcpProcess;
  readonly configOptions: readonly CursorConfigOption[];
};

function baseModel(model: string | undefined): string {
  const value = model?.trim() || "default";
  const bracket = value.indexOf("[");
  return bracket === -1 ? value : value.slice(0, bracket);
}

function configValue(
  option: CursorConfigOption | undefined,
  requested: string,
): string | boolean | undefined {
  if (!option) return undefined;
  if (option.type === "boolean") return requested === "true";
  const target = normalized(requested);
  return selectChoices(option).find(
    (choice) => normalized(choice.value) === target || normalized(choice.name) === target,
  )?.value;
}

function selectionValue(
  selections: readonly NawcProviderOptionSelection[] | undefined,
  id: string,
): string | boolean | undefined {
  return selections?.find((selection) => selection.id === id)?.value;
}

function referencesPrompt(
  prompt: string,
  references: NawcProviderTurnInput["references"],
  skillsDir: string,
  mode: string | undefined,
): string {
  const context = references.length
    ? `\n\nContext selected in NAWC:\n${references
        .map((reference) => {
          switch (reference.type) {
            case "file":
              return `- Project file: ${JSON.stringify(reference.path)}`;
            case "skill":
              return `- Skill $${reference.name}: ${JSON.stringify(reference.path)} (read it before acting)`;
            case "note":
              return reference.content
                ? `- Current note ${JSON.stringify(reference.path)}:\n\n${reference.content}`
                : `- Current note ${JSON.stringify(reference.path)} (content already in this thread)`;
            case "diagnostic":
              return `- Diagnostic${reference.file ? ` in ${reference.file}${reference.line ? `:${reference.line}` : ""}` : ""}: ${reference.message}`;
          }
        })
        .join("\n")}`
    : "";
  const modeInstruction =
    mode === "plan"
      ? "\n\nWork in plan mode: inspect the request and repository, then explain the proposed changes without editing files."
      : mode === "review"
        ? "\n\nReview the current work. Report concrete findings without editing files."
        : "";
  return `${prompt}${context}\n\nNAWC plugin skills are available in ${skillsDir}. Read the relevant SKILL.md files before editing NAWC notes.${modeInstruction}`;
}

function requestDetails(request: PendingRequest): {
  readonly title: string;
  readonly details?: string;
  readonly choices?: readonly (string | NawcProviderRequestChoice)[];
  readonly allowCustom?: boolean;
} {
  const params = isRecord(request.params) ? request.params : {};
  if (request.method === "session/request_permission") {
    const toolCall = isRecord(params.toolCall) ? params.toolCall : {};
    const choices = cursorPermissionChoices(params);
    return {
      title: typeof toolCall.title === "string" ? toolCall.title : "Cursor requests permission",
      ...(typeof toolCall.rawInput === "string" ? { details: toolCall.rawInput } : {}),
      ...(choices.length > 0 ? { choices } : {}),
    };
  }
  if (request.method === "cursor/ask_question") {
    const questions = Array.isArray(params.questions) ? params.questions : [];
    const first = isRecord(questions[0]) ? questions[0] : undefined;
    const choices = cursorQuestionChoices(first);
    return {
      title: typeof params.title === "string" ? params.title : "Cursor asks a question",
      ...(typeof first?.prompt === "string" ? { details: first.prompt } : {}),
      ...(choices.length > 0 ? { choices } : {}),
      allowCustom: true,
    };
  }
  return { title: request.method };
}

export function cursorPermissionChoices(params: unknown): readonly NawcProviderRequestChoice[] {
  if (!isRecord(params) || !Array.isArray(params.options)) return [];
  return params.options.flatMap((option) => {
    if (!isRecord(option) || typeof option.optionId !== "string") return [];
    return [
      {
        id: option.optionId,
        label: typeof option.name === "string" ? option.name : option.optionId,
      },
    ];
  });
}

export function cursorQuestionChoices(question: unknown): readonly string[] {
  if (!isRecord(question) || !Array.isArray(question.options)) return ["OK"];
  const choices = question.options.flatMap((option) =>
    isRecord(option) && typeof option.label === "string" && option.label ? [option.label] : [],
  );
  return choices.length > 0 ? choices : ["OK"];
}

export function cursorPermissionOptionId(params: unknown, decision: string): string | undefined {
  if (!isRecord(params) || !Array.isArray(params.options)) return;
  for (const option of params.options) {
    if (isRecord(option) && option.optionId === decision) return decision;
  }
}

export function cursor(options: CursorOptions = {}): NawcProvider {
  const sessions = new Map<string, CursorSession>();
  const executables = options.executable ? [options.executable] : DEFAULT_CURSOR_EXECUTABLES;

  const makeArgs = (): readonly string[] => [
    ...(options.apiEndpoint ? ["-e", options.apiEndpoint] : []),
    "acp",
  ];

  const startAcp = async (cwd: string): Promise<CursorAcpProcess> => {
    let lastError: unknown;
    for (const executable of executables) {
      let acp: CursorAcpProcess | undefined;
      try {
        acp = await CursorAcpProcess.start({ executable, args: makeArgs(), cwd });
        await acp.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
            _meta: { parameterizedModelPicker: true },
          },
          clientInfo: { name: "nawc", title: "NAWC", version: "0.0.0" },
        });
        await acp.request("authenticate", { methodId: "cursor_login" });
        return acp;
      } catch (error) {
        acp?.close();
        if (!isMissingExecutable(error)) throw error;
        lastError = error;
      }
    }
    throw new Error(
      `Cursor Agent CLI was not found. Install it with ` +
        `https://cursor.com/install or configure cursor({ executable: "..." }).`,
      { cause: lastError },
    );
  };

  const createSession = async (input: {
    readonly cwd: string;
    readonly providerThreadId?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly options?: readonly NawcProviderOptionSelection[];
    readonly mode?: string;
  }): Promise<CursorSession> => {
    const acp = await startAcp(input.cwd);
    try {
      const setup = input.providerThreadId
        ? await acp.request("session/load", {
            sessionId: input.providerThreadId,
            cwd: input.cwd,
            mcpServers: [],
          })
        : await acp.request("session/new", { cwd: input.cwd, mcpServers: [] });
      if (!isRecord(setup)) throw new Error("Cursor returned an invalid session response");
      const sessionId =
        input.providerThreadId ??
        (typeof setup.sessionId === "string" ? setup.sessionId : undefined);
      if (!sessionId) throw new Error("Cursor did not return a session ID");
      const session: CursorSession = {
        id: randomUUID(),
        providerThreadId: sessionId,
        acp,
        configOptions: configOptions(setup.configOptions),
      };
      acp.sessionId = sessionId;
      acp.setServerRequestHandler((request) => {
        if (
          request.method === "session/request_permission" ||
          request.method === "cursor/ask_question" ||
          request.method === "cursor/create_plan" ||
          request.method === "cursor/update_todos"
        ) {
          acp.rememberServerRequest(request);
          const extensionEvent = mapCursorExtensionRequest(request);
          if (extensionEvent) acp.push(extensionEvent);
          if (request.method === "cursor/create_plan" || request.method === "cursor/update_todos") {
            acp.respond(request.id, {});
            return;
          }
          acp.push({ kind: "request", request });
          return;
        }
        acp.respondError(request.id, `NAWC does not support Cursor request ${request.method}`);
      });
      await applySessionSettings(session, input);
      return session;
    } catch (error) {
      acp.close();
      throw error;
    }
  };

  async function applySessionSettings(
    session: CursorSession,
    input: {
      readonly model?: string;
      readonly reasoningEffort?: string;
      readonly options?: readonly NawcProviderOptionSelection[];
      readonly mode?: string;
    },
  ): Promise<void> {
    const modelOption =
      session.configOptions.find((option) => option.category === "model") ??
      findOption(session.configOptions, ["model"]);
    const model = input.model ?? options.model;
    if (model) {
      if (modelOption) {
        await session.acp.request("session/set_config_option", {
          sessionId: session.providerThreadId,
          configId: modelOption.id,
          value: baseModel(model),
        });
      } else {
        await session.acp.request("session/set_model", {
          sessionId: session.providerThreadId,
          modelId: baseModel(model),
        });
      }
    }
    const reasoning = findReasoningOption(session.configOptions);
    const reasoningEffort = input.reasoningEffort ?? options.reasoningEffort;
    if (reasoningEffort && reasoning) {
      const value = configValue(reasoning, reasoningEffort);
      if (value !== undefined)
        await session.acp.request("session/set_config_option", {
          sessionId: session.providerThreadId,
          configId: reasoning.id,
          value,
        });
    }
    const optionMap = [
      ["contextWindow", ["context", "context_size", "context-window"]],
      ["fastMode", ["fast", "fast-mode"]],
      ["thinking", ["thinking"]],
    ] as const;
    for (const [selectionId, ids] of optionMap) {
      const selected = selectionValue(input.options, selectionId);
      const option = findOption(session.configOptions, ids);
      if (selected === undefined || !option) continue;
      const value = configValue(option, String(selected));
      if (value !== undefined)
        await session.acp.request("session/set_config_option", {
          sessionId: session.providerThreadId,
          configId: option.id,
          value,
        });
    }
    if (input.mode && input.mode !== "default") {
      const modeOption = findOption(session.configOptions, ["mode"]);
      const value = modeOption ? configValue(modeOption, input.mode) : undefined;
      if (modeOption && value !== undefined)
        await session.acp.request("session/set_config_option", {
          sessionId: session.providerThreadId,
          configId: modeOption.id,
          value,
        });
    }
  }

  const discoverModels = async (cwd: string): Promise<readonly NawcProviderModel[]> => {
    const acp = await startAcp(cwd);
    try {
      const setup = await acp.request("session/new", { cwd, mcpServers: [] });
      if (isRecord(setup) && typeof setup.sessionId === "string") acp.sessionId = setup.sessionId;
      return parseCursorModelsResponse(
        await acp.request("cursor/list_available_models", {}, MODEL_DISCOVERY_TIMEOUT_MS),
      );
    } finally {
      acp.close();
    }
  };

  const provider: NawcProvider = {
    name: "cursor",
    label: "Cursor",
    capabilities: ["attachments", "interrupt", "requests", "resume", "session-model-switch"],
    modes: [
      { id: "default", label: "Build" },
      { id: "plan", label: "Plan" },
      { id: "review", label: "Review" },
    ],
    listModels: ({ cwd }) => discoverModels(cwd),
    getSettings: async ({ cwd }): Promise<NawcProviderSettings> => {
      const models = await discoverModels(cwd);
      const selected = options.model
        ? models.find((model) => model.id === options.model)
        : models[0];
      return {
        ...(selected ? { model: selected.id } : {}),
        ...((options.reasoningEffort ?? selected?.defaultReasoningEffort)
          ? { reasoningEffort: options.reasoningEffort ?? selected?.defaultReasoningEffort }
          : {}),
        ...(selected?.reasoningEfforts ? { reasoningEfforts: selected.reasoningEfforts } : {}),
      };
    },
    startSession: async (input) => {
      const session = await createSession(input);
      sessions.set(session.id, session);
      return session;
    },
    sendTurn: async function* (sessionInput, input) {
      const session = sessions.get(sessionInput.id);
      if (!session) throw new Error("Unknown Cursor session");
      await applySessionSettings(session, input);
      yield { type: "thread.started", threadId: session.providerThreadId! };
      yield { type: "turn.started" };
      let active = true;
      const prompt = session.acp
        .request(
          "session/prompt",
          {
            sessionId: session.providerThreadId,
            prompt: [
              {
                type: "text",
                text: referencesPrompt(input.prompt, input.references, input.skillsDir, input.mode),
              },
              ...(input.attachments ?? []).map((attachment) => ({
                type: "image",
                data: attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1),
                mimeType: attachment.mimeType,
              })),
            ],
          },
          0,
        )
        .then(
          (result) => {
            if (active) session.acp.push({ kind: "prompt-completed", result });
          },
          (error: unknown) => {
            if (active)
              session.acp.push({
                kind: "prompt-failed",
                error: error instanceof Error ? error : new Error(String(error)),
              });
          },
        );
      void prompt;
      try {
        while (true) {
          const item = await session.acp.next(input.signal);
          if ("type" in item) {
            yield item;
          } else if (item.kind === "request") {
            const details = requestDetails(item.request);
            yield {
              type: "request.opened",
              requestId: String(item.request.id),
              requestKind: item.request.method,
              title: details.title,
              ...(details.details ? { details: details.details } : {}),
              ...(details.choices ? { choices: details.choices } : {}),
              ...(details.allowCustom ? { allowCustom: true } : {}),
            };
          } else if (item.kind === "prompt-failed") {
            throw item.error;
          } else {
            break;
          }
        }
      } catch (error) {
        if (input.signal?.aborted) {
          session.acp.cancel();
          return;
        }
        throw error;
      } finally {
        active = false;
      }
      for (const item of session.acp.drain()) {
        if ("type" in item) yield item;
        else if (item.kind === "request") {
          const details = requestDetails(item.request);
          yield {
            type: "request.opened",
            requestId: String(item.request.id),
            requestKind: item.request.method,
            title: details.title,
            ...(details.details ? { details: details.details } : {}),
            ...(details.choices ? { choices: details.choices } : {}),
            ...(details.allowCustom ? { allowCustom: true } : {}),
          };
        }
      }
      yield { type: "turn.completed" };
    },
    interrupt: async (sessionInput) => {
      const session = sessions.get(sessionInput.id);
      if (session) session.acp.cancel();
    },
    respondToRequest: async (sessionInput, requestId, decision) => {
      const session = sessions.get(sessionInput.id);
      if (!session) throw new Error("Unknown Cursor session");
      const request =
        session.acp.getServerRequest(`string:${requestId}`) ??
        session.acp.getServerRequest(`number:${requestId}`);
      if (!request) throw new Error(`Unknown Cursor request: ${requestId}`);
      if (request.method === "session/request_permission") {
        const optionId = cursorPermissionOptionId(request.params, decision);
        if (!optionId) throw new Error(`Unknown Cursor permission choice: ${decision}`);
        session.acp.respond(request.id, { outcome: { outcome: "selected", optionId } });
      } else if (request.method === "cursor/ask_question") {
        const params = isRecord(request.params) ? request.params : {};
        const questions = Array.isArray(params.questions) ? params.questions : [];
        const first = isRecord(questions[0]) ? questions[0] : undefined;
        const id = typeof first?.id === "string" ? first.id : "answer";
        session.acp.respond(request.id, {
          answers: decision === "cancel" ? {} : { [id]: decision },
        });
      } else session.acp.respond(request.id, {});
    },
    closeSession: async (sessionInput) => {
      const session = sessions.get(sessionInput.id);
      if (!session) return;
      sessions.delete(session.id);
      session.acp.close();
    },
  };
  return provider;
}

export { cursor as default };
