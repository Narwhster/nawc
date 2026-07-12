import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  NawcProvider,
  NawcProviderSession,
  NawcProviderTurnInput,
  ProviderEvent,
} from "@nawc/config";
import {
  createAgentThread,
  projectProviderEvent,
  startAgentTurn,
  type AgentThread,
} from "./agent-thread.ts";

type SendTurnInput = Omit<NawcProviderTurnInput, "cwd" | "skillsDir" | "signal"> & {
  readonly threadId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentThread(value: unknown): value is AgentThread {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.provider === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.status === "idle" || value.status === "running" || value.status === "error") &&
    Array.isArray(value.turns) &&
    value.turns.every(
      (turn) =>
        isRecord(turn) &&
        typeof turn.id === "string" &&
        typeof turn.createdAt === "string" &&
        typeof turn.updatedAt === "string",
    ) &&
    Array.isArray(value.messages) &&
    value.messages.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.text === "string" &&
        typeof entry.turnId === "string",
    ) &&
    Array.isArray(value.activities) &&
    Array.isArray(value.requests) &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === "string") &&
    Array.isArray(value.unknownEvents)
  );
}

export class AgentManager {
  readonly #provider: NawcProvider;
  readonly #cwd: string;
  readonly #skillsDir: string;
  readonly #storageFile: string;
  readonly #threads = new Map<string, AgentThread>();
  readonly #sessions = new Map<string, NawcProviderSession>();
  readonly #controllers = new Map<string, AbortController>();
  #persisting = Promise.resolve();

  constructor(input: {
    readonly provider: NawcProvider;
    readonly cwd: string;
    readonly skillsDir: string;
    readonly storageFile: string;
  }) {
    this.#provider = input.provider;
    this.#cwd = input.cwd;
    this.#skillsDir = input.skillsDir;
    this.#storageFile = input.storageFile;
  }

  async load(): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(this.#storageFile, "utf8"));
      const entries = Array.isArray(value)
        ? value
        : isRecord(value) && value.version === 1 && Array.isArray(value.threads)
          ? value.threads
          : [];
      let recovered = false;
      for (const thread of entries) {
        if (!isAgentThread(thread) || thread.provider !== this.#provider.name) continue;
        if (thread.status === "running") {
          recovered = true;
          thread.status = "idle";
          thread.warnings.push("The previous agent process stopped before this turn completed.");
          for (const turn of thread.turns)
            if (turn.status === "running") turn.status = "interrupted";
          for (const entry of thread.messages) entry.streaming = false;
        }
        this.#threads.set(thread.id, thread);
      }
      if (recovered) await this.#persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  metadata() {
    return {
      name: this.#provider.name,
      label: this.#provider.label ?? this.#provider.name,
      capabilities: this.#provider.capabilities ?? [],
      modes: this.#provider.modes ?? [{ id: "default", label: "Build" }],
    };
  }

  listThreads(): readonly AgentThread[] {
    return [...this.#threads.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  getThread(id: string): AgentThread | undefined {
    return this.#threads.get(id);
  }

  async createThread(settings: {
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly options?: NawcProviderTurnInput["options"];
    readonly mode?: string;
  }): Promise<AgentThread> {
    const thread = createAgentThread(this.#provider.name);
    thread.model = settings.model;
    thread.reasoningEffort = settings.reasoningEffort;
    thread.options = settings.options;
    thread.mode = settings.mode;
    this.#threads.set(thread.id, thread);
    await this.#persist();
    return thread;
  }

  async deleteThread(id: string): Promise<void> {
    const thread = this.#requireThread(id);
    const session = this.#sessions.get(id);
    if (session) await this.#provider.closeSession?.(session);
    this.#controllers.get(id)?.abort();
    this.#controllers.delete(id);
    this.#sessions.delete(id);
    this.#threads.delete(thread.id);
    await this.#persist();
  }

  async *sendTurn(input: SendTurnInput): AsyncIterable<ProviderEvent> {
    const thread = this.#requireThread(input.threadId);
    if (thread.status === "running") throw new Error("This agent thread is already running");
    thread.model = input.model ?? thread.model;
    thread.reasoningEffort = input.reasoningEffort ?? thread.reasoningEffort;
    thread.options = input.options ?? thread.options;
    thread.mode = input.mode ?? thread.mode;
    const turn = startAgentTurn(thread, {
      text: input.prompt,
      references: input.references,
      attachments: input.attachments,
    });
    const controller = new AbortController();
    this.#controllers.set(thread.id, controller);
    await this.#persist();
    try {
      let session = this.#sessions.get(thread.id);
      if (!session) {
        session = this.#provider.startSession
          ? await this.#provider.startSession({
              cwd: this.#cwd,
              providerThreadId: thread.providerThreadId,
              model: thread.model,
              reasoningEffort: thread.reasoningEffort,
              options: thread.options,
              mode: thread.mode,
            })
          : { id: thread.id, providerThreadId: thread.providerThreadId };
        this.#sessions.set(thread.id, session);
      }
      const providerInput: NawcProviderTurnInput = {
        prompt: input.prompt,
        cwd: this.#cwd,
        skillsDir: this.#skillsDir,
        references: input.references,
        attachments: input.attachments,
        model: thread.model,
        reasoningEffort: thread.reasoningEffort,
        options: thread.options,
        mode: thread.mode,
        signal: controller.signal,
      };
      const events = this.#provider.sendTurn
        ? this.#provider.sendTurn(session, providerInput)
        : this.#provider.prompt?.(providerInput);
      if (!events) throw new Error(`Provider ${this.#provider.name} cannot send turns`);
      let completed = false;
      for await (const event of events) {
        projectProviderEvent(thread, turn.id, event);
        if (event.type === "thread.started") {
          session = { ...session, providerThreadId: event.threadId };
          this.#sessions.set(thread.id, session);
        }
        if (event.type === "turn.completed" || event.type === "done") completed = true;
        await this.#persist();
        yield { ...event, turnId: event.turnId ?? turn.id };
      }
      if (!completed && !controller.signal.aborted) {
        const event = { type: "turn.completed", turnId: turn.id } as const;
        projectProviderEvent(thread, turn.id, event);
        await this.#persist();
        yield event;
      }
    } catch (error) {
      const event: ProviderEvent = {
        type: controller.signal.aborted ? "turn.interrupted" : "error",
        turnId: turn.id,
        ...(controller.signal.aborted
          ? {}
          : { message: error instanceof Error ? error.message : String(error) }),
      } as ProviderEvent;
      projectProviderEvent(thread, turn.id, event);
      await this.#persist();
      yield event;
    } finally {
      this.#controllers.delete(thread.id);
    }
  }

  async interrupt(threadId: string): Promise<void> {
    const session = this.#sessions.get(threadId);
    this.#controllers.get(threadId)?.abort();
    if (session) await this.#provider.interrupt?.(session);
  }

  async respondToRequest(threadId: string, requestId: string, decision: string): Promise<void> {
    const session = this.#sessions.get(threadId);
    if (!session || !this.#provider.respondToRequest)
      throw new Error("This provider cannot respond to interactive requests");
    await this.#provider.respondToRequest(session, requestId, decision);
  }

  async close(): Promise<void> {
    for (const threadId of this.#controllers.keys()) await this.interrupt(threadId);
    for (const session of this.#sessions.values()) await this.#provider.closeSession?.(session);
    await this.#persisting;
  }

  #requireThread(id: string): AgentThread {
    const thread = this.#threads.get(id);
    if (!thread) throw new Error(`Unknown agent thread: ${id}`);
    return thread;
  }

  #persist(): Promise<void> {
    this.#persisting = this.#persisting
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(this.#storageFile), { recursive: true });
        const temporary = `${this.#storageFile}.tmp`;
        await writeFile(
          temporary,
          `${JSON.stringify({ version: 1, threads: this.listThreads() }, undefined, 2)}\n`,
        );
        await rename(temporary, this.#storageFile);
      });
    return this.#persisting;
  }
}
