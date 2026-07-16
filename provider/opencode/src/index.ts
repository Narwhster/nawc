import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createOpencodeClient,
  type OpencodeClient,
  type ProviderListResponse,
} from "@opencode-ai/sdk/v2";
import { execa } from "execa";
import type {
  NawcProvider,
  NawcProviderModel,
  NawcProviderReasoningEffort,
  NawcProviderSkill,
  ProviderEvent,
} from "@nawc/config";

type JsonObject = Record<string, unknown>;

const DEFAULT_OPENCODE_SERVER_TIMEOUT_MS = 5_000;

type RunningOpencodeServer = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

function mapOpencodeEvent(event: JsonObject): ProviderEvent | undefined {
  const type = typeof event.type === "string" ? event.type : undefined;
  const part =
    event.part && typeof event.part === "object" ? (event.part as JsonObject) : undefined;

  if (type === "step_start") return { type: "turn.started" };

  if (type === "error") {
    const error = event.error && typeof event.error === "object" ? (event.error as JsonObject) : {};
    const data = error.data && typeof error.data === "object" ? (error.data as JsonObject) : {};
    const message =
      typeof data.message === "string"
        ? data.message
        : typeof error.name === "string"
          ? error.name
          : "OpenCode failed";
    return { type: "error", message };
  }

  if (type === "text" && part && typeof part.text === "string") {
    const itemId = typeof part.id === "string" ? part.id : undefined;
    return {
      type: "message.completed",
      ...(itemId ? { itemId } : {}),
      text: part.text,
    };
  }

  if (type === "tool_use" && part) {
    const tool = typeof part.tool === "string" ? part.tool : "tool";
    const state = part.state && typeof part.state === "object" ? (part.state as JsonObject) : {};
    const status = typeof state.status === "string" ? state.status : "completed";
    const title = typeof state.title === "string" ? state.title : tool;
    const output = typeof state.output === "string" ? state.output : undefined;
    const itemId =
      typeof part.callID === "string"
        ? part.callID
        : typeof part.id === "string"
          ? part.id
          : undefined;
    return {
      type: "tool.completed",
      ...(itemId ? { itemId } : {}),
      tool,
      title,
      status: status === "error" ? "failed" : "completed",
      ...(output ? { output } : {}),
    };
  }

  if (type === "step_finish" && part) {
    const reason = typeof part.reason === "string" ? part.reason : undefined;
    if (reason !== "stop") return undefined;
    const tokens =
      part.tokens && typeof part.tokens === "object" ? (part.tokens as JsonObject) : undefined;
    const input = tokens && typeof tokens.input === "number" ? tokens.input : undefined;
    const output = tokens && typeof tokens.output === "number" ? tokens.output : undefined;
    return {
      type: "turn.completed",
      ...(input !== undefined || output !== undefined
        ? {
            usage: {
              ...(input !== undefined ? { input } : {}),
              ...(output !== undefined ? { output } : {}),
            },
          }
        : {}),
    };
  }

  return {
    type: "unknown",
    sourceType: type ?? "opencode.unknown",
    payload: event,
  };
}

export function parseOpencodeEvent(line: string): ProviderEvent | undefined {
  let event: JsonObject;
  try {
    event = JSON.parse(line) as JsonObject;
  } catch {
    return { type: "error", message: `OpenCode emitted invalid JSON: ${line}` };
  }
  return mapOpencodeEvent(event);
}

export function parseOpencodeModels(output: string): readonly NawcProviderModel[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => isOpencodeModelSlug(line))
    .map((line) => ({ id: line, name: line }));
}

function isOpencodeModelSlug(value: string): boolean {
  return /^[a-z0-9._-]+(?:\/[a-z0-9._-]+)+$/i.test(value);
}

function inferDefaultVariant(providerID: string, variants: readonly string[]): string | undefined {
  if (variants.length === 1) return variants[0];
  if (providerID === "anthropic" || providerID.startsWith("google"))
    return variants.includes("high") ? "high" : undefined;
  if (providerID === "openai" || providerID === "opencode")
    return variants.includes("medium") ? "medium" : variants.includes("high") ? "high" : undefined;
  return undefined;
}

export function parseOpencodeVerboseModels(output: string): readonly NawcProviderModel[] {
  const lines = output.split("\n");
  const models: NawcProviderModel[] = [];
  let i = 0;
  while (i < lines.length) {
    const slugLine = lines[i].trim();
    if (isOpencodeModelSlug(slugLine)) {
      i++;
      const jsonLines: string[] = [];
      let braceCount = 0;
      while (i < lines.length) {
        const jsonLine = lines[i];
        jsonLines.push(jsonLine);
        braceCount += jsonLine.split("{").length - 1 - (jsonLine.split("}").length - 1);
        i++;
        if (braceCount === 0) break;
      }
      try {
        const obj = JSON.parse(jsonLines.join("\n")) as Record<string, unknown>;
        const providerID = typeof obj.providerID === "string" ? obj.providerID : "opencode";
        const id = typeof obj.id === "string" ? `${providerID}/${obj.id}` : slugLine;
        const name = typeof obj.name === "string" ? obj.name : id;
        const variants =
          obj.variants && typeof obj.variants === "object"
            ? Object.keys(obj.variants as Record<string, unknown>)
            : [];
        const reasoningEfforts: NawcProviderReasoningEffort[] | undefined =
          variants.length > 0 ? variants.map((variant) => ({ id: variant })) : undefined;
        const defaultReasoningEffort =
          variants.length > 0 ? inferDefaultVariant(providerID, variants) : undefined;
        models.push({
          id,
          name,
          ...(reasoningEfforts?.length ? { reasoningEfforts } : {}),
          ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
        });
      } catch {
        models.push({ id: slugLine, name: slugLine });
      }
    } else {
      i++;
    }
  }
  return models;
}

export type OpencodeOptions = {
  readonly executable?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly serverTimeoutMs?: number;
};

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function buildOpencodeConfigContent(
  skillsDir: string,
  existingContent?: string,
): string | undefined {
  const resolvedSkillsDir = path.resolve(skillsDir);
  let config: JsonObject = {};
  if (existingContent) {
    try {
      const parsed = JSON.parse(existingContent) as unknown;
      if (!isJsonObject(parsed)) return undefined;
      config = parsed;
    } catch {
      return undefined;
    }
  }
  const skills = isJsonObject(config.skills) ? config.skills : {};
  const paths = Array.isArray(skills.paths)
    ? skills.paths.filter((item): item is string => typeof item === "string")
    : [];
  return JSON.stringify({
    ...config,
    skills: {
      ...skills,
      paths: paths.includes(resolvedSkillsDir) ? paths : [...paths, resolvedSkillsDir],
    },
  });
}

function parseFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  )
    return trimmed.slice(1, -1);
  return trimmed;
}

export function parseOpencodeSkillFile(
  content: string,
  file: string,
): NawcProviderSkill | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatter) return undefined;
  let name: string | undefined;
  let description: string | undefined;
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = /^(name|description):\s*(.+)$/.exec(line);
    if (!match) continue;
    const value = parseFrontmatterValue(match[2]);
    if (match[1] === "name") name = value;
    else description = value;
  }
  if (!name || !description || path.basename(path.dirname(file)) !== name) return undefined;
  return { name, path: file, shortDescription: "OpenCode skill", description };
}

async function findOpencodeSkillFiles(directory: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findOpencodeSkillFiles(file)));
    else if (entry.name === "SKILL.md" && (entry.isFile() || entry.isSymbolicLink()))
      files.push(file);
  }
  return files;
}

function opencodeSkillRoots(cwd: string): readonly string[] {
  const roots = [
    path.join(os.homedir(), ".config", "opencode", "skill"),
    path.join(os.homedir(), ".config", "opencode", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
    path.join(os.homedir(), ".agents", "skills"),
  ];
  let directory = path.resolve(cwd);
  while (true) {
    roots.push(
      path.join(directory, ".opencode", "skill"),
      path.join(directory, ".opencode", "skills"),
      path.join(directory, ".claude", "skills"),
      path.join(directory, ".agents", "skills"),
    );
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return [...new Set(roots)];
}

function formatOpencodeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const data = value.data;
    if (data && typeof data === "object") {
      const message = (data as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    try {
      return JSON.stringify(error) ?? "OpenCode returned an unknown error";
    } catch {
      return "OpenCode returned an unserializable error";
    }
  }
  return typeof error === "string" ? error : "OpenCode returned an unknown error";
}

function parseOpencodeServerUrl(output: string): string | undefined {
  const match = output.match(/opencode server listening on (https?:\/\/[^\s]+)/);
  return match?.[1];
}

async function startOpencodeServer(
  executable: string,
  cwd: string,
  timeoutMs: number,
): Promise<RunningOpencodeServer> {
  const child = execa(executable, ["serve", "--hostname=127.0.0.1", "--port=0"], {
    cwd,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({}),
    },
    reject: false,
  });

  let output = "";
  let closed = false;
  const terminate = (signal: NodeJS.Signals) => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // Fall back to terminating the direct child below.
      }
    }
    child.kill(signal);
  };

  const url = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminate("SIGTERM");
      reject(new Error(`Timed out waiting ${timeoutMs}ms for OpenCode server startup`));
    }, timeoutMs);
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const onChunk = (chunk: Buffer | string) => {
      output += chunk.toString();
      const serverUrl = parseOpencodeServerUrl(output);
      if (serverUrl) settle(() => resolve(serverUrl));
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.once("error", (error) => settle(() => reject(error)));
    child.once("exit", (code, signal) => {
      settle(() =>
        reject(
          new Error(
            [
              `OpenCode server exited before startup completed (code: ${String(code)}, signal: ${String(signal)}).`,
              output.trim() ? `OpenCode output:\n${output.trim()}` : undefined,
            ]
              .filter(Boolean)
              .join("\n\n"),
          ),
        ),
      );
    });
  }).catch((error: unknown) => {
    throw new Error(`Failed to start OpenCode server: ${formatOpencodeError(error)}`, {
      cause: error,
    });
  });

  return {
    url,
    close: async () => {
      if (closed) return;
      closed = true;
      terminate("SIGTERM");
      const exited = await Promise.race([
        child.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      if (!exited) {
        terminate("SIGKILL");
        await child;
      }
    },
  };
}

export function flattenOpencodeModels(
  providerList: ProviderListResponse,
): readonly NawcProviderModel[] {
  const connected = new Set(providerList.connected);
  const models: NawcProviderModel[] = [];

  for (const provider of providerList.all) {
    if (!connected.has(provider.id)) continue;

    for (const model of Object.values(provider.models)) {
      const name = model.name.trim();
      if (!name) continue;
      const variants = Object.keys(model.variants ?? {});
      const reasoningEfforts: NawcProviderReasoningEffort[] | undefined =
        variants.length > 0 ? variants.map((variant) => ({ id: variant })) : undefined;
      const defaultReasoningEffort =
        variants.length > 0 ? inferDefaultVariant(provider.id, variants) : undefined;
      models.push({
        id: `${provider.id}/${model.id}`,
        name,
        ...(reasoningEfforts?.length ? { reasoningEfforts } : {}),
        ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
      });
    }
  }

  return models.sort((left, right) => left.name.localeCompare(right.name));
}

async function listOpencodeModels(
  executable: string,
  cwd: string,
  timeoutMs = DEFAULT_OPENCODE_SERVER_TIMEOUT_MS,
): Promise<readonly NawcProviderModel[]> {
  const server = await startOpencodeServer(executable, cwd, timeoutMs);
  try {
    const client: OpencodeClient = createOpencodeClient({
      baseUrl: server.url,
      directory: cwd,
      throwOnError: true,
    });
    const response = await client.provider.list();
    if (!response.data) throw new Error("OpenCode returned an empty provider inventory");
    return flattenOpencodeModels(response.data);
  } catch (error) {
    throw new Error(`OpenCode model discovery failed: ${formatOpencodeError(error)}`, {
      cause: error,
    });
  } finally {
    await server.close();
  }
}

async function listOpencodeSkills(
  cwd: string,
  skillsDir?: string,
): Promise<readonly NawcProviderSkill[]> {
  const excluded = skillsDir ? path.resolve(skillsDir) : undefined;
  const files = [
    ...new Set(
      (
        await Promise.all(
          opencodeSkillRoots(cwd).map((directory) => findOpencodeSkillFiles(directory)),
        )
      ).flat(),
    ),
  ].filter((file) => {
    const resolved = path.resolve(file);
    return !excluded || (resolved !== excluded && !resolved.startsWith(`${excluded}${path.sep}`));
  });
  const skills = await Promise.all(
    files.map(async (file) => parseOpencodeSkillFile(await readFile(file, "utf8"), file)),
  );
  const byName = new Map<string, NawcProviderSkill>();
  for (const skill of skills) if (skill) byName.set(skill.name, skill);
  return [...byName.values()];
}

export function opencode(options: OpencodeOptions = {}): NawcProvider {
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
    const args = ["run", "--format", "json", "--dir", cwd];
    if (resume) args.push("--session", resume);
    if (model ?? options.model) args.push("--model", model ?? options.model!);
    if (reasoningEffort ?? options.reasoningEffort)
      args.push("--variant", reasoningEffort ?? options.reasoningEffort!);
    const readOnly = mode === "plan" || mode === "review";
    if (!readOnly) args.push("--auto");
    const attachmentDirectory = attachments?.length
      ? await mkdtemp(path.join(os.tmpdir(), "nawc-opencode-"))
      : undefined;
    if (attachmentDirectory) {
      for (const [index, attachment] of attachments!.entries()) {
        const safeName = path.basename(attachment.name).replaceAll(/[^a-zA-Z0-9._-]/g, "-");
        const file = path.join(attachmentDirectory, `${index}-${safeName || "attachment"}`);
        const encoded = attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1);
        await writeFile(file, Buffer.from(encoded, "base64"));
        args.push("-f", file);
      }
    }
    const opencodeConfigContent = buildOpencodeConfigContent(
      skillsDir,
      process.env.OPENCODE_CONFIG_CONTENT,
    );
    const child = execa(options.executable ?? "opencode", args, {
      cwd,
      extendEnv: true,
      ...(opencodeConfigContent ? { env: { OPENCODE_CONFIG_CONTENT: opencodeConfigContent } } : {}),
      input: prompt + referenceInstruction + skillInstruction + modeInstruction,
      reject: false,
    });
    active.set(session.id, child);
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (!child.stdout) {
        yield { type: "error", message: "OpenCode did not expose an output stream" };
        return;
      }
      let buffer = "";
      let threadStarted = Boolean(resume);
      let turnStarted = false;
      let sawError = false;
      const eventsFromLine = (eventLine: string): readonly ProviderEvent[] => {
        let raw: JsonObject;
        try {
          raw = JSON.parse(eventLine) as JsonObject;
        } catch {
          sawError = true;
          return [{ type: "error", message: `OpenCode emitted invalid JSON: ${eventLine}` }];
        }
        const out: ProviderEvent[] = [];
        if (!threadStarted) {
          const sid = typeof raw.sessionID === "string" ? raw.sessionID : undefined;
          if (sid) {
            out.push({ type: "thread.started", threadId: sid });
            threadStarted = true;
          }
        }
        const mapped = mapOpencodeEvent(raw);
        if (!mapped) return out;
        if (mapped.type === "error") sawError = true;
        if (mapped.type === "turn.started") {
          if (turnStarted) return out;
          turnStarted = true;
        }
        out.push(mapped);
        return out;
      };
      for await (const chunk of child.stdout) {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const eventLine of lines) {
          if (!eventLine.trim()) continue;
          for (const event of eventsFromLine(eventLine)) yield event;
        }
      }
      if (buffer.trim()) {
        for (const event of eventsFromLine(buffer)) yield event;
      }
      const result = await child;
      if (result.exitCode !== 0 && !signal?.aborted && !sawError)
        yield {
          type: "error",
          message: result.stderr || `OpenCode exited with code ${result.exitCode}`,
        };
    } finally {
      signal?.removeEventListener("abort", abort);
      active.delete(session.id);
      if (attachmentDirectory) await rm(attachmentDirectory, { recursive: true, force: true });
    }
  };

  return {
    name: "opencode",
    label: "OpenCode",
    capabilities: ["attachments", "resume", "interrupt", "session-model-switch"],
    modes: [
      {
        id: "default",
        label: "Build",
        description: "Allow OpenCode to inspect and edit the workspace",
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
    listSkills: ({ cwd, skillsDir }) => listOpencodeSkills(cwd, skillsDir),
    listModels: ({ cwd }) =>
      listOpencodeModels(options.executable ?? "opencode", cwd, options.serverTimeoutMs),
    getSettings: async ({ cwd }) => {
      const models = await listOpencodeModels(
        options.executable ?? "opencode",
        cwd,
        options.serverTimeoutMs,
      );
      const configuredModel = options.model;
      const model = configuredModel
        ? models.find((item) => item.id === configuredModel)
        : models[0];
      return {
        ...(configuredModel ? { model: configuredModel } : model ? { model: model.id } : {}),
        ...(options.reasoningEffort
          ? { reasoningEffort: options.reasoningEffort }
          : model?.defaultReasoningEffort
            ? { reasoningEffort: model.defaultReasoningEffort }
            : {}),
        ...(model?.reasoningEfforts ? { reasoningEfforts: model.reasoningEfforts } : {}),
      };
    },
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
