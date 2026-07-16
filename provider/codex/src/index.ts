import { spawn as spawnProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type {
  NawcProvider,
  NawcProviderModel,
  NawcProviderReasoningEffort,
  NawcProviderSettings,
  NawcProviderSkill,
  ProviderEvent,
} from "@nawc/config";

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
    let buffer = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
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
  const active = new Map<string, ReturnType<typeof execa>>();
  const runTurn = async function* (
    session: { readonly id: string; readonly providerThreadId?: string },
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
    const modeInstruction =
      mode === "plan"
        ? "\n\nWork in plan mode: inspect the request and repository, then explain the proposed changes without editing files."
        : mode === "review"
          ? "\n\nReview the current work. Report concrete findings without editing files."
          : "";
    const resume = session.providerThreadId;
    const args = resume
      ? ["exec", "resume", "--json"]
      : [
          "exec",
          "--json",
          "--color",
          "never",
          "--sandbox",
          mode === "plan" || mode === "review"
            ? "read-only"
            : (options.sandbox ?? "workspace-write"),
          "-C",
          cwd,
        ];
    if (model ?? options.model) args.push("--model", model ?? options.model!);
    if (reasoningEffort ?? options.reasoningEffort)
      args.push(
        "--config",
        `model_reasoning_effort=${JSON.stringify(reasoningEffort ?? options.reasoningEffort)}`,
      );
    for (const selection of modelOptions ?? []) {
      if (selection.id === "serviceTier" && typeof selection.value === "string")
        args.push("--config", `service_tier=${JSON.stringify(selection.value)}`);
    }
    const attachmentDirectory = attachments?.length
      ? await mkdtemp(path.join(os.tmpdir(), "nawc-codex-"))
      : undefined;
    if (attachmentDirectory) {
      for (const [index, attachment] of attachments!.entries()) {
        const safeName = path.basename(attachment.name).replaceAll(/[^a-zA-Z0-9._-]/g, "-");
        const file = path.join(attachmentDirectory, `${index}-${safeName || "image"}`);
        const encoded = attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1);
        await writeFile(file, Buffer.from(encoded, "base64"));
        args.push("--image", file);
      }
    }
    if (resume) args.push(resume);
    args.push("-");
    const child = execa(options.executable ?? "codex", args, {
      cwd,
      input: prompt + referenceInstruction + skillInstruction + modeInstruction,
      reject: false,
    });
    active.set(session.id, child);
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (!child.stdout) {
        yield { type: "error", message: "Codex did not expose an output stream" };
        return;
      }
      let buffer = "";
      for await (const chunk of child.stdout) {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const eventLine of lines) {
          if (!eventLine.trim()) continue;
          const parsed = parseCodexEvent(eventLine);
          if (parsed) yield parsed;
        }
      }
      if (buffer.trim()) {
        const parsed = parseCodexEvent(buffer);
        if (parsed) yield parsed;
      }
      const result = await child;
      if (result.exitCode !== 0 && !signal?.aborted)
        yield {
          type: "error",
          message: result.stderr || `Codex exited with code ${result.exitCode}`,
        };
    } finally {
      signal?.removeEventListener("abort", abort);
      active.delete(session.id);
      if (attachmentDirectory) await rm(attachmentDirectory, { recursive: true, force: true });
    }
  };
  return {
    name: "codex",
    label: "Codex",
    capabilities: ["attachments", "resume", "interrupt", "session-model-switch"],
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
    async startSession({ providerThreadId }) {
      return { id: randomUUID(), providerThreadId };
    },
    sendTurn: runTurn,
    async interrupt(session) {
      active.get(session.id)?.kill("SIGTERM");
    },
    async *prompt(input) {
      yield* runTurn({ id: randomUUID() }, input);
    },
  };
}
