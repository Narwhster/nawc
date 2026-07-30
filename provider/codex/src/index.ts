import { spawn as spawnProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  NawcProvider,
  NawcProviderModel,
  NawcProviderRequestChoice,
  NawcProviderReasoningEffort,
  NawcProviderSettings,
  NawcProviderSkill,
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

export function parseCodexEvent(line: string): ProviderEvent | undefined {
  let event: JsonObject;
  try {
    event = JSON.parse(line) as JsonObject;
  } catch {
    return { type: "error", message: `Codex emitted invalid JSON: ${line}` };
  }

  if (event.type === "thread.started" && typeof event.thread_id === "string") {
    return { type: "thread.started", threadId: event.thread_id };
  }
  if (event.type === "error") {
    return {
      type: "error",
      message: typeof event.message === "string" ? event.message : "Codex failed",
    };
  }
  if (event.type === "turn.started") return { type: "turn.started" };
  if (event.type === "event_msg") {
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : undefined;
    if (payload?.type !== "token_count") return undefined;
    const info =
      payload.info && typeof payload.info === "object"
        ? (payload.info as Record<string, unknown>)
        : undefined;
    const last =
      info?.last_token_usage && typeof info.last_token_usage === "object"
        ? (info.last_token_usage as Record<string, unknown>)
        : undefined;
    if (!last) return undefined;
    const input = typeof last.input_tokens === "number" ? last.input_tokens : undefined;
    const output = typeof last.output_tokens === "number" ? last.output_tokens : undefined;
    const total = typeof last.total_tokens === "number" ? last.total_tokens : undefined;
    const contextWindow =
      typeof info?.model_context_window === "number" ? info.model_context_window : undefined;
    if (input === undefined && output === undefined && total === undefined) return undefined;
    return {
      type: "context.updated",
      usage: {
        ...(input !== undefined ? { input } : {}),
        ...(output !== undefined ? { output } : {}),
        ...(total !== undefined ? { total } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
      },
    };
  }
  if (event.type === "turn.completed") {
    const usage =
      event.usage && typeof event.usage === "object"
        ? (event.usage as Record<string, unknown>)
        : undefined;
    return {
      type: "turn.completed",
      ...(usage
        ? {
            usage: {
              ...(typeof usage.input_tokens === "number" ? { input: usage.input_tokens } : {}),
              ...(typeof usage.output_tokens === "number" ? { output: usage.output_tokens } : {}),
              ...(typeof usage.total_tokens === "number" ? { total: usage.total_tokens } : {}),
              ...(typeof usage.model_context_window === "number"
                ? { contextWindow: usage.model_context_window }
                : {}),
            },
          }
        : {}),
    };
  }

  const item =
    typeof event.item === "object" && event.item ? (event.item as JsonObject) : undefined;
  if (
    event.type === "item.completed" &&
    item?.type === "agent_message" &&
    typeof item.text === "string"
  ) {
    return {
      type: "message.completed",
      ...(typeof item.id === "string" ? { itemId: item.id } : {}),
      text: item.text,
    };
  }
  if (
    (event.type === "item.started" || event.type === "item.completed") &&
    item?.type === "command_execution"
  ) {
    return {
      type: event.type === "item.started" ? "tool.started" : "tool.completed",
      ...(typeof item.id === "string" ? { itemId: item.id } : {}),
      tool: "command_execution",
      title: typeof item.command === "string" ? item.command : "Command",
      status:
        event.type === "item.started"
          ? "running"
          : item.status === "failed"
            ? "failed"
            : "completed",
      ...(typeof item.aggregated_output === "string" ? { output: item.aggregated_output } : {}),
    };
  }
  if (
    (event.type === "item.started" || event.type === "item.completed") &&
    typeof item?.type === "string"
  ) {
    const title =
      typeof item.name === "string"
        ? item.name
        : typeof item.path === "string"
          ? item.path
          : item.type.replaceAll("_", " ");
    return {
      type: event.type === "item.started" ? "tool.started" : "tool.completed",
      ...(typeof item.id === "string" ? { itemId: item.id } : {}),
      tool: item.type,
      title,
      status: event.type === "item.started" ? "running" : "completed",
      ...(typeof item.text === "string" ? { output: item.text } : {}),
    };
  }
  return {
    type: "unknown",
    sourceType: typeof event.type === "string" ? event.type : "codex.unknown",
    payload: event,
  };
}

export type CodexOptions = {
  readonly executable?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly sandbox?: "read-only" | "workspace-write";
};

type JsonRpcResponse = {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly message?: unknown };
};

type CodexAppMessage = {
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly message?: unknown };
};

function codexDecisionId(decision: unknown): string | undefined {
  if (typeof decision === "string") return decision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return;
  try {
    return JSON.stringify(decision);
  } catch {
    return;
  }
}

function codexDecisionLabel(decision: unknown): string | undefined {
  const value =
    typeof decision === "string"
      ? decision
      : decision && typeof decision === "object" && !Array.isArray(decision)
        ? Object.keys(decision)[0]
        : undefined;
  if (!value) return;
  return value
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function codexApprovalChoices(params: unknown): readonly NawcProviderRequestChoice[] {
  if (!params || typeof params !== "object" || Array.isArray(params)) return [];
  const available = (params as Record<string, unknown>).availableDecisions;
  if (!Array.isArray(available)) return [];
  return available.flatMap((decision) => {
    const id = codexDecisionId(decision);
    const label = codexDecisionLabel(decision);
    return id && label ? [{ id, label }] : [];
  });
}

export function codexApprovalDecision(params: unknown, id: string): unknown {
  if (!params || typeof params !== "object" || Array.isArray(params)) return;
  const available = (params as Record<string, unknown>).availableDecisions;
  if (!Array.isArray(available)) return;
  return available.find((decision) => codexDecisionId(decision) === id);
}

function codexPermissionResponses(params: unknown): readonly {
  readonly label: string;
  readonly response: {
    readonly permissions: unknown;
    readonly scope: "turn" | "session";
    readonly strictAutoReview?: boolean;
  };
}[] {
  if (!params || typeof params !== "object" || Array.isArray(params)) return [];
  const permissions = (params as Record<string, unknown>).permissions;
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return [];
  return [
    { label: "Allow for turn", response: { permissions, scope: "turn" } },
    {
      label: "Allow for turn with strict auto review",
      response: { permissions, scope: "turn", strictAutoReview: true },
    },
    { label: "Allow for session", response: { permissions, scope: "session" } },
    { label: "Decline", response: { permissions: {}, scope: "turn" } },
  ];
}

export function codexPermissionChoices(params: unknown): readonly NawcProviderRequestChoice[] {
  return codexPermissionResponses(params).map(({ label, response }) => ({
    id: JSON.stringify(response),
    label,
  }));
}

export function codexPermissionResponse(params: unknown, id: string): unknown {
  return codexPermissionResponses(params).find(({ response }) => JSON.stringify(response) === id)
    ?.response;
}

type CodexCollaborationMode = {
  readonly name: string;
  readonly mode?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
};

export function parseCodexCollaborationModes(value: unknown): readonly CodexCollaborationMode[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string") return [];
    return [
      {
        name: record.name,
        ...(typeof record.mode === "string" ? { mode: record.mode } : {}),
        ...(typeof record.model === "string" ? { model: record.model } : {}),
        ...(typeof record.reasoning_effort === "string"
          ? { reasoningEffort: record.reasoning_effort }
          : {}),
      },
    ];
  });
}

class CodexAppServer {
  readonly #child;
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  readonly #messages: CodexAppMessage[] = [];
  readonly #waiters: ((message: CodexAppMessage) => void)[] = [];
  #id = 0;
  #buffer = "";
  #stderr = "";

  private constructor(executable: string, cwd: string) {
    this.#child = spawnProcess(executable, ["app-server"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    trackChildPid(this.#child.pid);
    this.#child.once("close", () => {
      untrackChildPid(this.#child.pid);
    });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk: string) => this.#onData(chunk));
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (chunk: string) => {
      this.#stderr += chunk;
    });
    this.#child.on("error", (error) => this.#fail(error));
    this.#child.on("close", (code) =>
      this.#fail(
        new Error(this.#stderr.trim() || `Codex app-server exited with code ${code ?? "unknown"}`),
      ),
    );
  }

  static async start(executable: string, cwd: string): Promise<CodexAppServer> {
    const server = new CodexAppServer(executable, cwd);
    await server.request("initialize", {
      clientInfo: { name: "nawc", title: "NAWC", version: "0.0.0" },
      capabilities: { experimentalApi: true },
    });
    server.notify("initialized", {});
    return server;
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  respond(id: unknown, result: unknown): void {
    this.#send({ jsonrpc: "2.0", id, result });
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.#send({ jsonrpc: "2.0", method, params });
  }

  next(signal?: AbortSignal): Promise<CodexAppMessage> {
    const message = this.#messages.shift();
    if (message) return Promise.resolve(message);
    return new Promise((resolve, reject) => {
      const waiter = (value: CodexAppMessage) => {
        signal?.removeEventListener("abort", abort);
        resolve(value);
      };
      const abort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(new Error("Codex request interrupted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  close(): void {
    this.#child.kill();
  }

  #send(message: Record<string, unknown>): void {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #fail(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    const message: CodexAppMessage = {
      method: "error",
      params: { message: error.message },
    };
    const waiter = this.#waiters.shift();
    if (waiter) waiter(message);
    else this.#messages.push(message);
  }

  #onData(chunk: string): void {
    this.#buffer += chunk;
    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: CodexAppMessage;
      try {
        message = JSON.parse(line) as CodexAppMessage;
      } catch {
        continue;
      }
      if (typeof message.id === "number" && !message.method) {
        const pending = this.#pending.get(message.id);
        if (!pending) continue;
        this.#pending.delete(message.id);
        if (message.error)
          pending.reject(
            new Error(
              typeof message.error.message === "string"
                ? message.error.message
                : "Codex app-server request failed",
            ),
          );
        else pending.resolve(message.result);
        continue;
      }
      const waiter = this.#waiters.shift();
      if (waiter) waiter(message);
      else this.#messages.push(message);
    }
  }
}

export function mapCodexAppServerEvent(message: CodexAppMessage): ProviderEvent | undefined {
  const method = typeof message.method === "string" ? message.method : undefined;
  const params =
    message.params && typeof message.params === "object"
      ? (message.params as Record<string, unknown>)
      : {};
  if (method === "item/tool/requestUserInput") {
    const questions = Array.isArray(params.questions) ? params.questions : [];
    const first =
      questions[0] && typeof questions[0] === "object"
        ? (questions[0] as Record<string, unknown>)
        : undefined;
    if (!first || (typeof message.id !== "string" && typeof message.id !== "number")) return;
    const options = Array.isArray(first.options) ? first.options : [];
    const choices = options.flatMap((option) =>
      option &&
      typeof option === "object" &&
      typeof (option as Record<string, unknown>).label === "string"
        ? [(option as Record<string, unknown>).label as string]
        : [],
    );
    return {
      type: "request.opened",
      requestId: `${message.id}`,
      requestKind: "question",
      title: typeof first.header === "string" ? first.header : "Codex asks a question",
      ...(typeof first.question === "string" ? { details: first.question } : {}),
      ...(choices.length > 0 ? { choices } : {}),
      allowCustom: true,
    };
  }
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval"
  ) {
    if (typeof message.id !== "string" && typeof message.id !== "number") return;
    const choices =
      method === "item/permissions/requestApproval"
        ? codexPermissionChoices(params)
        : codexApprovalChoices(params);
    return {
      type: "request.opened",
      requestId: `${message.id}`,
      requestKind: method,
      title:
        method === "item/commandExecution/requestApproval"
          ? typeof params.command === "string"
            ? params.command
            : "Codex requests command approval"
          : method === "item/fileChange/requestApproval"
            ? "Codex requests file-change approval"
            : "Codex requests additional permissions",
      ...(typeof params.reason === "string"
        ? { details: params.reason }
        : method === "item/permissions/requestApproval" && params.permissions
          ? { details: JSON.stringify(params.permissions, null, 2) }
          : {}),
      ...(choices.length > 0 ? { choices } : {}),
    };
  }
  if (method === "turn/started") return { type: "turn.started" };
  if (method === "turn/completed") return { type: "turn.completed" };
  if (method === "item/agentMessage/delta" && typeof params.delta === "string")
    return {
      type: "message.delta",
      ...(typeof params.itemId === "string" ? { itemId: params.itemId } : {}),
      text: params.delta,
    };
  if (method === "item/completed" || method === "item/started") {
    const item =
      params.item && typeof params.item === "object"
        ? (params.item as Record<string, unknown>)
        : undefined;
    if (!item || typeof item.type !== "string") return;
    if (item.type === "agentMessage" && method === "item/started")
      return {
        type: "message.started",
        ...(typeof item.id === "string" ? { itemId: item.id } : {}),
        role: "assistant",
      };
    if (item.type === "agentMessage")
      return {
        type: "message.completed",
        ...(typeof item.id === "string" ? { itemId: item.id } : {}),
        ...(typeof item.text === "string" ? { text: item.text } : {}),
      };
    const title =
      item.type === "commandExecution" && typeof item.command === "string"
        ? item.command
        : item.type === "mcpToolCall" && typeof item.tool === "string"
          ? item.tool
          : item.type;
    return {
      type: method === "item/started" ? "tool.started" : "tool.completed",
      ...(typeof item.id === "string" ? { itemId: item.id } : {}),
      tool: item.type,
      title,
      status:
        method === "item/started" ? "running" : item.status === "failed" ? "failed" : "completed",
      ...(typeof item.aggregatedOutput === "string" ? { output: item.aggregatedOutput } : {}),
    };
  }
  if (method === "warning" && typeof params.message === "string")
    return { type: "warning", message: params.message };
  if (method === "error") {
    const error =
      params.error && typeof params.error === "object"
        ? (params.error as Record<string, unknown>)
        : {};
    return {
      type: "error",
      message:
        typeof error.message === "string"
          ? error.message
          : typeof params.message === "string"
            ? params.message
            : "Codex failed",
    };
  }
}

async function requestCodexAppServer(
  executable: string,
  cwd: string,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, ["app-server"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    trackChildPid(child.pid);
    let buffer = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      untrackChildPid(child.pid);
      child.kill();
      if (error) reject(error);
      else resolve(value);
    };

    const send = (request: Record<string, unknown>) => {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: JsonRpcResponse;
        try {
          const parsed: unknown = JSON.parse(line);
          if (!parsed || typeof parsed !== "object") continue;
          message = parsed as JsonRpcResponse;
        } catch {
          continue;
        }
        if (message.id === 1) {
          if (message.error) {
            finish(
              new Error(
                typeof message.error.message === "string"
                  ? message.error.message
                  : "Codex app-server failed to initialize",
              ),
            );
            return;
          }
          send({ jsonrpc: "2.0", method: "initialized", params: {} });
          send({ jsonrpc: "2.0", id: 2, method, params });
        } else if (message.id === 2) {
          if (message.error) {
            finish(
              new Error(
                typeof message.error.message === "string"
                  ? message.error.message
                  : `Codex app-server failed to call ${method}`,
              ),
            );
            return;
          }
          finish(undefined, message.result);
          return;
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!settled)
        finish(
          new Error(stderr.trim() || `Codex app-server exited with code ${code ?? "unknown"}`),
        );
    });
    timeout = setTimeout(() => finish(new Error(`Timed out waiting for Codex ${method}`)), 10_000);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "nawc", title: "NAWC", version: "0.0.0" },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

export function parseCodexSkillsResponse(value: unknown): readonly NawcProviderSkill[] {
  if (!value || typeof value !== "object") return [];
  const data = (value as { readonly data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const entries = data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const skills = (entry as { readonly skills?: unknown }).skills;
    return Array.isArray(skills) ? skills : [];
  });
  return entries.flatMap((skill): NawcProviderSkill[] => {
    if (!skill || typeof skill !== "object") return [];
    const item = skill as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.path !== "string") return [];
    const interfaceInfo =
      item.interface && typeof item.interface === "object"
        ? (item.interface as Record<string, unknown>)
        : undefined;
    const displayName = item.displayName ?? interfaceInfo?.displayName;
    const shortDescription = item.shortDescription ?? interfaceInfo?.shortDescription;
    return [
      {
        name: item.name,
        path: item.path,
        ...(typeof item.enabled === "boolean" ? { enabled: item.enabled } : {}),
        ...(typeof item.scope === "string" ? { scope: item.scope } : {}),
        ...(typeof displayName === "string" ? { displayName } : {}),
        ...(typeof shortDescription === "string" ? { shortDescription } : {}),
        ...(typeof item.description === "string" ? { description: item.description } : {}),
      },
    ];
  });
}

async function listCodexSkills(
  executable: string,
  cwd: string,
): Promise<readonly NawcProviderSkill[]> {
  return parseCodexSkillsResponse(
    await requestCodexAppServer(executable, cwd, "skills/list", { cwds: [cwd] }),
  );
}

export function parseCodexModelsResponse(value: unknown): readonly NawcProviderModel[] {
  if (!value || typeof value !== "object") return [];
  const data = (value as { readonly data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((model): NawcProviderModel[] => {
    if (!model || typeof model !== "object") return [];
    const item = model as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : item.model;
    if (typeof id !== "string" || item.hidden === true) return [];
    const name = typeof item.displayName === "string" ? item.displayName : id;
    const reasoningEfforts = Array.isArray(item.supportedReasoningEfforts)
      ? item.supportedReasoningEfforts.flatMap((effort): NawcProviderReasoningEffort[] => {
          if (typeof effort === "string") return [{ id: effort }];
          if (!effort || typeof effort !== "object") return [];
          const entry = effort as Record<string, unknown>;
          const effortId =
            typeof entry.reasoningEffort === "string"
              ? entry.reasoningEffort
              : typeof entry.id === "string"
                ? entry.id
                : undefined;
          return effortId
            ? [
                {
                  id: effortId,
                  ...(typeof entry.description === "string"
                    ? { description: entry.description }
                    : {}),
                },
              ]
            : [];
        })
      : undefined;
    const speedTiers = Array.isArray(item.serviceTiers)
      ? item.serviceTiers.flatMap((tier): { id: string; label: string; description?: string }[] => {
          if (typeof tier === "string")
            return [{ id: tier, label: tier === "fast" ? "Fast" : tier }];
          if (!tier || typeof tier !== "object") return [];
          const entry = tier as Record<string, unknown>;
          if (typeof entry.id !== "string") return [];
          return [
            {
              id: entry.id,
              label: typeof entry.name === "string" ? entry.name : entry.id,
              ...(typeof entry.description === "string" && entry.description
                ? { description: entry.description }
                : {}),
            },
          ];
        })
      : Array.isArray(item.additionalSpeedTiers)
        ? item.additionalSpeedTiers.flatMap((tier) =>
            typeof tier === "string" ? [{ id: tier, label: tier === "fast" ? "Fast" : tier }] : [],
          )
        : [];
    return [
      {
        id,
        name,
        ...(typeof item.description === "string" ? { description: item.description } : {}),
        ...(reasoningEfforts?.length ? { reasoningEfforts } : {}),
        ...(typeof item.defaultReasoningEffort === "string"
          ? { defaultReasoningEffort: item.defaultReasoningEffort }
          : {}),
        ...(item.isDefault === true ? { isDefault: true } : {}),
        ...(speedTiers.length
          ? {
              options: [
                {
                  id: "serviceTier",
                  label: "Service tier",
                  type: "select" as const,
                  choices: [{ id: "default", label: "Standard" }, ...speedTiers],
                  defaultValue:
                    typeof item.defaultServiceTier === "string"
                      ? item.defaultServiceTier
                      : "default",
                },
              ],
            }
          : {}),
      },
    ];
  });
}

async function listCodexModels(
  executable: string,
  cwd: string,
): Promise<readonly NawcProviderModel[]> {
  const models: NawcProviderModel[] = [];
  let cursor: string | undefined;
  do {
    const value = await requestCodexAppServer(
      executable,
      cwd,
      "model/list",
      cursor ? { cursor } : {},
    );
    models.push(...parseCodexModelsResponse(value));
    if (!value || typeof value !== "object") break;
    const nextCursor = (value as { readonly nextCursor?: unknown }).nextCursor;
    cursor = typeof nextCursor === "string" && nextCursor ? nextCursor : undefined;
  } while (cursor);
  return models;
}

async function getCodexSettings(
  executable: string,
  cwd: string,
  configuredModel?: string,
  configuredReasoningEffort?: string,
): Promise<NawcProviderSettings> {
  const models = await listCodexModels(executable, cwd);
  const model = configuredModel
    ? models.find((item) => item.id === configuredModel)
    : models.find((item) => item.isDefault);
  return {
    ...((configuredModel ?? model?.id) ? { model: configuredModel ?? model?.id } : {}),
    ...((configuredReasoningEffort ?? model?.defaultReasoningEffort)
      ? { reasoningEffort: configuredReasoningEffort ?? model?.defaultReasoningEffort }
      : {}),
    ...(model?.reasoningEfforts ? { reasoningEfforts: model.reasoningEfforts } : {}),
  };
}

export function codex(options: CodexOptions = {}): NawcProvider {
  type CodexSession = {
    readonly id: string;
    readonly cwd: string;
    providerThreadId?: string;
    threadLoaded: boolean;
    effectiveModel?: string;
    effectiveReasoningEffort?: string;
    collaborationModes?: readonly CodexCollaborationMode[];
    server?: CodexAppServer;
    readonly requests: Map<
      string,
      {
        readonly id: unknown;
        readonly method: string;
        readonly params: unknown;
        readonly questionId?: string;
      }
    >;
  };
  const sessions = new Map<string, CodexSession>();

  const runTurn = async function* (
    session: CodexSession,
    {
      prompt,
      cwd,
      skillsDir,
      references,
      attachments,
      model,
      reasoningEffort,
      options: modelOptions,
      mode,
      signal,
    }: Parameters<NonNullable<NawcProvider["prompt"]>>[0],
  ): AsyncIterable<ProviderEvent> {
    const referenceInstruction = references.length
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
    const skillInstruction = `\n\nNAWC plugin skills are available in ${skillsDir}. Read the relevant SKILL.md files before editing NAWC notes.`;
    session.server ??= await CodexAppServer.start(options.executable ?? "codex", cwd);
    const server = session.server;
    if (session.collaborationModes === undefined) {
      session.collaborationModes = await server
        .request("collaborationMode/list", {})
        .then(parseCodexCollaborationModes)
        .catch(() => []);
    }
    const nativePlan = session.collaborationModes.find((candidate) => candidate.mode === "plan");
    if (session.providerThreadId && !session.threadLoaded) {
      const resumed = (await server.request("thread/resume", {
        threadId: session.providerThreadId,
        cwd,
        model: model ?? options.model ?? null,
      })) as { readonly model?: unknown; readonly reasoningEffort?: unknown };
      if (typeof resumed.model === "string") session.effectiveModel = resumed.model;
      if (typeof resumed.reasoningEffort === "string")
        session.effectiveReasoningEffort = resumed.reasoningEffort;
      session.threadLoaded = true;
    } else {
      if (!session.providerThreadId) {
        const started = (await server.request("thread/start", {
          cwd,
          model: model ?? options.model ?? null,
          ...(mode === "plan" || mode === "review"
            ? { sandbox: "read-only" }
            : options.sandbox
              ? { sandbox: options.sandbox }
              : {}),
          experimentalRawEvents: false,
        })) as {
          readonly thread?: { readonly id?: unknown };
          readonly model?: unknown;
          readonly reasoningEffort?: unknown;
        };
        const threadId = started.thread?.id;
        if (typeof threadId !== "string") throw new Error("Codex did not return a thread id");
        session.providerThreadId = threadId;
        if (typeof started.model === "string") session.effectiveModel = started.model;
        if (typeof started.reasoningEffort === "string")
          session.effectiveReasoningEffort = started.reasoningEffort;
        session.threadLoaded = true;
        yield { type: "thread.started", threadId };
      }
    }
    const threadId = session.providerThreadId;
    const selectedModel = model ?? options.model ?? session.effectiveModel;
    const selectedReasoningEffort =
      reasoningEffort ?? options.reasoningEffort ?? session.effectiveReasoningEffort;
    const modeInstruction =
      mode === "plan" && !nativePlan
        ? "\n\nWork in plan mode: inspect the request and repository, then explain the proposed changes without editing files."
        : mode === "review"
          ? "\n\nReview the current work. Report concrete findings without editing files."
          : "";
    const serviceTier = modelOptions?.find((selection) => selection.id === "serviceTier")?.value;
    const abort = () => {
      if (threadId) void server.request("turn/interrupt", { threadId }).catch(() => undefined);
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await server.request("turn/start", {
        threadId,
        additionalContext: {
          nawc: {
            kind: "application",
            value: referenceInstruction + skillInstruction + modeInstruction,
          },
        },
        input: [
          {
            type: "text",
            text: prompt,
            text_elements: [],
          },
          ...(attachments ?? []).map((attachment) => ({
            type: "image",
            url: attachment.dataUrl,
          })),
        ],
        model: selectedModel ?? null,
        effort: selectedReasoningEffort ?? null,
        ...(mode === "plan" && nativePlan && selectedModel
          ? {
              collaborationMode: {
                mode: nativePlan.mode,
                settings: {
                  model: nativePlan.model ?? selectedModel,
                  reasoning_effort: nativePlan.reasoningEffort ?? selectedReasoningEffort ?? null,
                  developer_instructions: null,
                },
              },
            }
          : {}),
        ...(typeof serviceTier === "string" ? { serviceTier } : {}),
      });
      while (true) {
        const native = await server.next(signal);
        const event = mapCodexAppServerEvent(native);
        if (!event) continue;
        if (event.type === "request.opened" && native.id !== undefined) {
          const params =
            native.params && typeof native.params === "object"
              ? (native.params as Record<string, unknown>)
              : {};
          const questions = Array.isArray(params.questions) ? params.questions : [];
          const first =
            questions[0] && typeof questions[0] === "object"
              ? (questions[0] as Record<string, unknown>)
              : undefined;
          session.requests.set(event.requestId, {
            id: native.id,
            method: typeof native.method === "string" ? native.method : event.requestKind,
            params: native.params,
            ...(typeof first?.id === "string" ? { questionId: first.id } : {}),
          });
        }
        yield event;
        if (
          event.type === "turn.completed" ||
          event.type === "turn.interrupted" ||
          event.type === "error"
        )
          break;
      }
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  };
  return {
    name: "codex",
    label: "Codex",
    capabilities: ["attachments", "resume", "interrupt", "requests", "session-model-switch"],
    modes: [
      {
        id: "default",
        label: "Build",
        description: "Allow Codex to inspect and edit the workspace",
      },
      {
        id: "plan",
        label: "Plan",
        description: "Inspect and propose changes without editing files",
      },
      {
        id: "review",
        label: "Review",
        description: "Review the current work without editing files",
      },
    ],
    getSettings: ({ cwd }) =>
      getCodexSettings(options.executable ?? "codex", cwd, options.model, options.reasoningEffort),
    listSkills: ({ cwd }) => listCodexSkills(options.executable ?? "codex", cwd),
    listModels: ({ cwd }) => listCodexModels(options.executable ?? "codex", cwd),
    async startSession({ cwd, providerThreadId }) {
      const session: CodexSession = {
        id: randomUUID(),
        cwd,
        providerThreadId,
        threadLoaded: false,
        requests: new Map(),
      };
      sessions.set(session.id, session);
      return session;
    },
    sendTurn(session, input) {
      const active = sessions.get(session.id);
      if (!active) throw new Error(`Unknown Codex session: ${session.id}`);
      return runTurn(active, input);
    },
    async interrupt(session) {
      const active = sessions.get(session.id);
      if (active?.server && active.providerThreadId)
        await active.server.request("turn/interrupt", { threadId: active.providerThreadId });
    },
    async respondToRequest(session, requestId, decision) {
      const active = sessions.get(session.id);
      const request = active?.requests.get(requestId);
      if (!active?.server || !request) throw new Error(`Unknown Codex request: ${requestId}`);
      if (request.method === "item/tool/requestUserInput") {
        active.server.respond(request.id, {
          answers: {
            [request.questionId ?? "answer"]: { answers: [decision] },
          },
        });
      } else if (request.method === "item/commandExecution/requestApproval") {
        const choices = codexApprovalChoices(request.params);
        const providerDecision = codexApprovalDecision(request.params, decision);
        if (choices.length > 0 && providerDecision === undefined)
          throw new Error(`Unknown Codex approval choice: ${decision}`);
        active.server.respond(request.id, { decision: providerDecision ?? decision });
      } else if (request.method === "item/permissions/requestApproval") {
        const response = codexPermissionResponse(request.params, decision);
        if (!response) throw new Error(`Unknown Codex permission choice: ${decision}`);
        active.server.respond(request.id, response);
      } else active.server.respond(request.id, { decision });
      active.requests.delete(requestId);
    },
    async closeSession(session) {
      sessions.delete(session.id);
      (session as CodexSession).server?.close();
    },
    async *prompt(input) {
      const session: CodexSession = {
        id: randomUUID(),
        cwd: input.cwd,
        threadLoaded: false,
        requests: new Map(),
      };
      try {
        yield* runTurn(session, input);
      } finally {
        session.server?.close();
      }
    },
  };
}
