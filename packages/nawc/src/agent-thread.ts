import { randomUUID } from "node:crypto";
import type {
  NawcAgentAttachment,
  NawcProviderOptionSelection,
  NawcProviderRequestChoice,
  NawcProviderUsage,
  ProviderEvent,
  PromptReference,
} from "@nawc/config";

export type AgentMessage = {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  text: string;
  readonly turnId: string;
  readonly createdAt: string;
  updatedAt: string;
  streaming: boolean;
  readonly references?: readonly PromptReference[];
  readonly attachments?: readonly Omit<NawcAgentAttachment, "dataUrl">[];
};

export type AgentActivity = {
  readonly id: string;
  readonly turnId: string;
  readonly createdAt: string;
  readonly tool: string;
  title: string;
  status: "running" | "completed" | "failed" | "declined";
  output?: string;
};

export type AgentRequest = {
  readonly id: string;
  readonly turnId: string;
  readonly kind: string;
  readonly title: string;
  readonly details?: string;
  readonly choices?: readonly (string | NawcProviderRequestChoice)[];
  readonly allowCustom?: boolean;
  status: "pending" | "resolved";
  decision?: string;
};

export type AgentTurn = {
  readonly id: string;
  status: "running" | "completed" | "interrupted" | "failed";
  readonly createdAt: string;
  updatedAt: string;
  plan?: string;
  thinking?: { text: string; createdAt: string }[];
  usage?: NawcProviderUsage;
};

export type AgentThread = {
  readonly id: string;
  readonly provider: string;
  providerSessionId?: string;
  providerThreadId?: string;
  readonly createdAt: string;
  updatedAt: string;
  model?: string;
  reasoningEffort?: string;
  options?: readonly NawcProviderOptionSelection[];
  mode?: string;
  status: "idle" | "running" | "error";
  readonly turns: AgentTurn[];
  readonly messages: AgentMessage[];
  readonly activities: AgentActivity[];
  readonly requests: AgentRequest[];
  readonly warnings: { readonly message: string; readonly turnId?: string }[];
  readonly unknownEvents: ProviderEvent[];
  /** Keys of refs already injected with full content into this thread's provider context. */
  readonly attachedReferenceKeys: string[];
};

const timestamp = () => new Date().toISOString();

export function createAgentThread(provider: string, id: string = randomUUID()): AgentThread {
  const now = timestamp();
  return {
    id,
    provider,
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
  };
}

export function startAgentTurn(
  thread: AgentThread,
  input: {
    readonly text: string;
    readonly references: readonly PromptReference[];
    readonly attachments?: readonly NawcAgentAttachment[];
  },
  turnId: string = randomUUID(),
): AgentTurn {
  const now = timestamp();
  const turn: AgentTurn = { id: turnId, status: "running", createdAt: now, updatedAt: now };
  thread.turns.push(turn);
  thread.messages.push({
    id: randomUUID(),
    role: "user",
    text: input.text,
    turnId,
    createdAt: now,
    updatedAt: now,
    streaming: false,
    references: input.references,
    attachments: input.attachments?.map(({ dataUrl: _dataUrl, ...attachment }) => attachment),
  });
  thread.status = "running";
  thread.updatedAt = now;
  return turn;
}

function findTurn(thread: AgentThread, turnId: string): AgentTurn {
  const turn = thread.turns.find((item) => item.id === turnId);
  if (!turn) throw new Error(`Unknown agent turn: ${turnId}`);
  return turn;
}

function assistantMessage(thread: AgentThread, turnId: string, event: ProviderEvent): AgentMessage {
  const itemId = event.itemId;
  const existing = [...thread.messages]
    .reverse()
    .find(
      (message) =>
        message.turnId === turnId &&
        message.role === "assistant" &&
        (itemId === undefined || message.id === itemId),
    );
  if (existing) return existing;
  const now = event.createdAt ?? timestamp();
  const message: AgentMessage = {
    id: itemId ?? randomUUID(),
    role: "assistant",
    text: "",
    turnId,
    createdAt: now,
    updatedAt: now,
    streaming: true,
  };
  thread.messages.push(message);
  return message;
}

export const MAX_UNKNOWN_EVENTS_PER_THREAD = 500;

export function projectProviderEvent(
  thread: AgentThread,
  defaultTurnId: string,
  event: ProviderEvent,
): void {
  const turnId = event.turnId ?? defaultTurnId;
  const now = event.createdAt ?? timestamp();
  thread.updatedAt = now;
  switch (event.type) {
    case "session.started":
      thread.providerSessionId = event.sessionId;
      return;
    case "thread.started":
      thread.providerThreadId = event.threadId;
      return;
    case "turn.started":
      return;
    case "message.started":
      assistantMessage(thread, turnId, event);
      return;
    case "message.delta": {
      const message = assistantMessage(thread, turnId, event);
      message.text += event.text;
      message.updatedAt = now;
      return;
    }
    case "message.completed":
    case "message": {
      const message = assistantMessage(thread, turnId, event);
      const text = event.type === "message" ? event.text : event.text;
      if (text !== undefined && (!message.text || text !== message.text)) message.text = text;
      message.streaming = false;
      message.updatedAt = now;
      return;
    }
    case "command":
    case "tool.started":
    case "tool.updated":
    case "tool.completed": {
      const legacy = event.type === "command";
      const id = event.itemId ?? event.id ?? `${turnId}:${legacy ? event.command : event.title}`;
      const existing = thread.activities.find((activity) => activity.id === id);
      const status = legacy
        ? event.status === "running"
          ? "running"
          : "completed"
        : (event.status ?? (event.type === "tool.completed" ? "completed" : "running"));
      if (existing) {
        existing.status = status;
        existing.title = legacy ? event.command : event.title;
        if (!legacy && event.output !== undefined) existing.output = event.output;
      } else {
        thread.activities.push({
          id,
          turnId,
          createdAt: now,
          tool: legacy ? "command_execution" : event.tool,
          title: legacy ? event.command : event.title,
          status,
          ...(!legacy && event.output !== undefined ? { output: event.output } : {}),
        });
      }
      return;
    }
    case "plan.updated":
      findTurn(thread, turnId).plan = event.markdown;
      return;
    case "thinking": {
      const turn = findTurn(thread, turnId);
      if (!turn.thinking) turn.thinking = [];
      turn.thinking.push({ text: event.text, createdAt: now });
      return;
    }
    case "request.opened":
      thread.requests.push({
        id: event.requestId,
        turnId,
        kind: event.requestKind,
        title: event.title,
        details: event.details,
        choices: event.choices,
        allowCustom: event.allowCustom,
        status: "pending",
      });
      return;
    case "request.resolved": {
      const request = thread.requests.find((item) => item.id === event.requestId);
      if (request) {
        request.status = "resolved";
        request.decision = event.decision;
      }
      return;
    }
    case "warning":
      thread.warnings.push({ message: event.message, turnId: event.turnId });
      return;
    case "error": {
      thread.status = "error";
      const turn = findTurn(thread, turnId);
      turn.status = "failed";
      turn.updatedAt = now;
      thread.warnings.push({ message: event.message, turnId: event.turnId ?? turnId });
      return;
    }
    case "turn.interrupted": {
      const turn = findTurn(thread, turnId);
      turn.status = "interrupted";
      turn.updatedAt = now;
      thread.status = "idle";
      return;
    }
    case "turn.completed":
    case "done": {
      const turn = findTurn(thread, turnId);
      turn.status = "completed";
      turn.updatedAt = now;
      if (event.type === "turn.completed" && event.usage)
        turn.usage = { ...turn.usage, ...event.usage };
      for (const message of thread.messages)
        if (message.turnId === turnId) message.streaming = false;
      thread.status = "idle";
      return;
    }
    case "context.updated": {
      const turn = findTurn(thread, turnId);
      turn.usage = event.usage;
      turn.updatedAt = now;
      thread.updatedAt = now;
      return;
    }
    case "unknown":
      thread.unknownEvents.push(event);
      if (thread.unknownEvents.length > MAX_UNKNOWN_EVENTS_PER_THREAD)
        thread.unknownEvents.splice(0, thread.unknownEvents.length - MAX_UNKNOWN_EVENTS_PER_THREAD);
      return;
  }
}
