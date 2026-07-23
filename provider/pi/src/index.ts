import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  createAgentSession,
  loadSkills,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  NawcAgentAttachment,
  NawcProvider,
  NawcProviderModel,
  NawcProviderSkill,
  ProviderEvent,
} from "@nawc/config";
import { Type } from "typebox";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type PiOptions = {
  readonly agentDir?: string;
  readonly sessionDir?: string;
  readonly model?: string;
  readonly reasoningEffort?: ThinkingLevel;
};

type PiSession = {
  readonly id: string;
  readonly providerThreadId?: string;
  readonly agent: AgentSession;
  readonly runtime: ModelRuntime;
  readonly pendingQuestions: Map<string, (answer: string) => void>;
  emit?: (event: ProviderEvent) => void;
};

const PiQuestionParams = Type.Object({
  question: Type.String({ description: "The question to ask the user" }),
  options: Type.Array(
    Type.Object({
      label: Type.String({ description: "Display label for the option" }),
      description: Type.Optional(Type.String({ description: "Explanation of the option" })),
    }),
  ),
  allowCustom: Type.Optional(
    Type.Boolean({ description: "Whether the user may type a custom answer" }),
  ),
});

export function piQuestionEvent(
  requestId: string,
  input: {
    readonly question: string;
    readonly options: readonly { readonly label: string }[];
    readonly allowCustom?: boolean;
  },
): ProviderEvent {
  return {
    type: "request.opened",
    requestId,
    requestKind: "question",
    title: "Pi asks a question",
    details: input.question,
    choices: input.options.map((option) => option.label),
    allowCustom: true,
  };
}

function modelRuntime(options: PiOptions): Promise<ModelRuntime> {
  return ModelRuntime.create({
    ...(options.agentDir ? { authPath: path.join(options.agentDir, "auth.json") } : {}),
    ...(options.agentDir ? { modelsPath: path.join(options.agentDir, "models.json") } : {}),
  });
}

function parseModel(id: string | undefined): { provider: string; model: string } | undefined {
  if (!id) return undefined;
  const separator = id.indexOf("/");
  if (separator <= 0 || separator === id.length - 1) return undefined;
  return { provider: id.slice(0, separator), model: id.slice(separator + 1) };
}

export function piModels(
  models: ReturnType<ModelRuntime["getAvailableSnapshot"]>,
): readonly NawcProviderModel[] {
  return models.map((model) => ({
    id: `${model.provider}/${model.id}`,
    name: model.name.trim() || `${model.provider}/${model.id}`,
    contextWindow: model.contextWindow,
    reasoningEfforts: (model.reasoning ? THINKING_LEVELS : ["off"]).map((id) => ({ id })),
    defaultReasoningEffort: model.reasoning ? "medium" : "off",
  }));
}

function piSkills(cwd: string, options: PiOptions): readonly NawcProviderSkill[] {
  return loadSkills({
    cwd,
    agentDir: options.agentDir ?? "",
    skillPaths: [],
    includeDefaults: true,
  }).skills.map((skill) => ({
    name: skill.name,
    path: skill.filePath,
    enabled: !skill.disableModelInvocation,
    description: skill.description,
  }));
}

function summarize(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[Pi returned non-serializable output]";
  }
}

export function mapPiEvent(event: AgentSessionEvent): ProviderEvent | undefined {
  switch (event.type) {
    case "turn_start":
      return { type: "turn.started" };
    case "message_start":
      return event.message.role === "assistant"
        ? { type: "message.started", role: "assistant" }
        : undefined;
    case "message_update":
      return event.assistantMessageEvent.type === "text_delta"
        ? { type: "message.delta", text: event.assistantMessageEvent.delta }
        : undefined;
    case "message_end":
      return event.message.role === "assistant" ? { type: "message.completed" } : undefined;
    case "tool_execution_start":
      return {
        type: "tool.started",
        itemId: event.toolCallId,
        tool: event.toolName,
        title: event.toolName,
        status: "running",
        output: summarize(event.args),
      };
    case "tool_execution_update":
      return {
        type: "tool.updated",
        itemId: event.toolCallId,
        tool: event.toolName,
        title: event.toolName,
        status: "running",
        output: summarize(event.partialResult),
      };
    case "tool_execution_end":
      return {
        type: "tool.completed",
        itemId: event.toolCallId,
        tool: event.toolName,
        title: event.toolName,
        status: event.isError ? "failed" : "completed",
        output: summarize(event.result),
      };
    case "auto_retry_start":
      return {
        type: "warning",
        message: `Pi is retrying (${event.attempt}/${event.maxAttempts}): ${event.errorMessage}`,
      };
    default:
      return undefined;
  }
}

function referenceInstructions(
  references: Parameters<NonNullable<NawcProvider["prompt"]>>[0]["references"],
  skillsDir: string,
): string {
  const selected = references.map((reference) => {
    switch (reference.type) {
      case "file":
        return `- Project file: ${JSON.stringify(reference.path)}`;
      case "skill":
        return `- Skill $${reference.name}: ${JSON.stringify(reference.path)} (read it before acting)`;
      case "note":
        return reference.content
          ? `- Current note ${JSON.stringify(reference.path)}:\n\n${reference.content}`
          : `- Current note ${JSON.stringify(reference.path)}`;
      case "diagnostic":
        return `- Diagnostic${reference.file ? ` in ${reference.file}${reference.line ? `:${reference.line}` : ""}` : ""}: ${reference.message}`;
    }
  });
  return `${selected.length ? `\n\nContext selected in NAWC:\n${selected.join("\n")}` : ""}\n\nNAWC plugin skills are available in ${skillsDir}. Read relevant SKILL.md files before editing NAWC notes.`;
}

function images(attachments: readonly NawcAgentAttachment[] | undefined) {
  return attachments?.map((attachment) => ({
    type: "image" as const,
    data: attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1),
    mimeType: attachment.mimeType,
  }));
}

export function pi(options: PiOptions = {}): NawcProvider {
  const sessions = new Map<string, PiSession>();

  async function createSession(input: Parameters<NonNullable<NawcProvider["startSession"]>>[0]) {
    const runtime = await modelRuntime(options);
    const selected = parseModel(input.model ?? options.model);
    const model = selected ? runtime.getModel(selected.provider, selected.model) : undefined;
    if (selected && !model)
      throw new Error(`Pi model is not available: ${input.model ?? options.model}`);
    const sessionManager = input.providerThreadId
      ? SessionManager.open(input.providerThreadId, options.sessionDir, input.cwd)
      : SessionManager.create(input.cwd, options.sessionDir);
    const pendingQuestions = new Map<string, (answer: string) => void>();
    let value: PiSession | undefined;
    const questionTool: ToolDefinition<typeof PiQuestionParams> = {
      name: "question",
      label: "Question",
      description:
        "Ask the user one multiple-choice question and wait for their answer before continuing.",
      promptSnippet: "Ask the user a question with clickable choices.",
      parameters: PiQuestionParams,
      executionMode: "sequential",
      async execute(toolCallId, params, signal) {
        const answer = await new Promise<string>((resolve, reject) => {
          const abort = () => {
            pendingQuestions.delete(toolCallId);
            reject(new Error("Question cancelled"));
          };
          signal?.addEventListener("abort", abort, { once: true });
          pendingQuestions.set(toolCallId, (decision) => {
            signal?.removeEventListener("abort", abort);
            resolve(decision);
          });
          value?.emit?.(piQuestionEvent(toolCallId, params));
        });
        pendingQuestions.delete(toolCallId);
        return {
          content: [{ type: "text", text: answer }],
          details: { question: params.question, answer },
        };
      },
    };
    const { session } = await createAgentSession({
      cwd: input.cwd,
      ...(options.agentDir ? { agentDir: options.agentDir } : {}),
      sessionManager,
      modelRuntime: runtime,
      ...(model ? { model } : {}),
      thinkingLevel:
        (input.reasoningEffort as ThinkingLevel | undefined) ?? options.reasoningEffort,
      ...(input.mode === "plan" || input.mode === "review"
        ? { tools: ["read", "grep", "find", "ls", "question"] }
        : {}),
      customTools: [questionTool],
    });
    const providerThreadId = session.sessionFile;
    value = {
      id: randomUUID(),
      providerThreadId,
      agent: session,
      runtime,
      pendingQuestions,
    };
    sessions.set(value.id, value);
    return value;
  }

  async function* runTurn(
    session: PiSession,
    input: Parameters<NonNullable<NawcProvider["prompt"]>>[0],
  ): AsyncIterable<ProviderEvent> {
    const selected = parseModel(input.model);
    if (selected) {
      const model = session.runtime.getModel(selected.provider, selected.model);
      if (!model) throw new Error(`Pi model is not available: ${input.model}`);
      await session.agent.setModel(model);
    }
    if (input.reasoningEffort) {
      if (!THINKING_LEVELS.includes(input.reasoningEffort as ThinkingLevel))
        throw new Error(`Unsupported Pi reasoning effort: ${input.reasoningEffort}`);
      session.agent.setThinkingLevel(input.reasoningEffort as ThinkingLevel);
    }
    const queued: ProviderEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    session.emit = (event) => {
      queued.push(event);
      wake?.();
      wake = undefined;
    };
    const unsubscribe = session.agent.subscribe((native) => {
      const mapped = mapPiEvent(native);
      if (mapped) queued.push(mapped);
      wake?.();
      wake = undefined;
    });
    const abort = () => void session.agent.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    const prompt = session.agent
      .prompt(input.prompt + referenceInstructions(input.references, input.skillsDir), {
        source: "rpc",
        images: images(input.attachments),
      })
      .catch((error: unknown) => {
        queued.push({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        finished = true;
        wake?.();
      });
    try {
      yield {
        type: "thread.started",
        threadId: session.agent.sessionFile ?? session.agent.sessionId,
      };
      while (!finished || queued.length > 0) {
        if (queued.length === 0)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        while (queued.length > 0) yield queued.shift()!;
      }
      await prompt;
      if (input.signal?.aborted) yield { type: "turn.interrupted" };
      else {
        const usage = session.agent.getContextUsage();
        yield {
          type: "turn.completed",
          ...(usage
            ? {
                usage: {
                  ...(usage.tokens === null ? {} : { total: usage.tokens }),
                  contextWindow: usage.contextWindow,
                },
              }
            : {}),
        };
      }
    } finally {
      session.emit = undefined;
      unsubscribe();
      input.signal?.removeEventListener("abort", abort);
    }
  }

  return {
    name: "pi",
    label: "Pi",
    capabilities: ["attachments", "resume", "interrupt", "requests", "session-model-switch"],
    modes: [
      { id: "default", label: "Build", description: "Allow Pi to inspect and edit the workspace" },
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
    getSettings: async () => ({
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      reasoningEfforts: THINKING_LEVELS.map((id) => ({ id })),
    }),
    listModels: async () => {
      const runtime = await modelRuntime(options);
      await runtime.getAvailable();
      return piModels(runtime.getAvailableSnapshot());
    },
    listSkills: async ({ cwd }) => piSkills(cwd, options),
    async startSession(input) {
      return createSession(input);
    },
    sendTurn(session, input) {
      const active = sessions.get(session.id);
      if (!active) throw new Error(`Unknown Pi session: ${session.id}`);
      return runTurn(active, input);
    },
    async interrupt(session) {
      await sessions.get(session.id)?.agent.abort();
    },
    async respondToRequest(session, requestId, decision) {
      const active = sessions.get(session.id);
      const resolve = active?.pendingQuestions.get(requestId);
      if (!active || !resolve) throw new Error(`Unknown Pi question: ${requestId}`);
      active.pendingQuestions.delete(requestId);
      resolve(decision);
    },
    async closeSession(session) {
      sessions.get(session.id)?.agent.dispose();
      sessions.delete(session.id);
    },
    async *prompt(input) {
      const session = await createSession({
        cwd: input.cwd,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        options: input.options,
        mode: input.mode,
      });
      try {
        yield* runTurn(session, input);
      } finally {
        session.agent.dispose();
        sessions.delete(session.id);
      }
    },
  };
}

export { pi as default };
