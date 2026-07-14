import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type {
  NawcProvider,
  NawcProviderModel,
  NawcProviderReasoningEffort,
  ProviderEvent,
} from "@nawc/config";

type JsonObject = Record<string, unknown>;

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
    .filter((line) => /^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(line))
    .map((line) => ({ id: line, name: line }));
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
    if (/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(slugLine)) {
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
};

async function listOpencodeModels(
  executable: string,
  cwd: string,
): Promise<readonly NawcProviderModel[]> {
  const result = await execa(executable, ["models", "--verbose"], { cwd, reject: false });
  return parseOpencodeVerboseModels(result.stdout ?? "");
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
                return `- Current note ${JSON.stringify(reference.path)}:\n\n${reference.content ?? ""}`;
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
    const child = execa(options.executable ?? "opencode", args, {
      cwd,
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
    listModels: ({ cwd }) => listOpencodeModels(options.executable ?? "opencode", cwd),
    getSettings: async ({ cwd }) => {
      const models = await listOpencodeModels(options.executable ?? "opencode", cwd);
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
