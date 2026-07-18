import type {
  NawcProvider,
  NawcProviderSession,
  NawcProviderTurnInput,
  ProviderEvent,
} from "@nawc/config";
import { displayReference, prepareTurnReferences } from "./agent-references.ts";
import {
  createAgentThread,
  projectProviderEvent,
  startAgentTurn,
  type AgentThread,
} from "./agent-thread.ts";

type SendTurnInput = Omit<NawcProviderTurnInput, "cwd" | "skillsDir" | "signal"> & {
  readonly threadId: string;
};
type AgentChangeListener = (threadId: string, thread: AgentThread | undefined) => void;

export class AgentManager {
  readonly #provider: NawcProvider;
  readonly #cwd: string;
  readonly #skillsDir: string;
  readonly #threads = new Map<string, AgentThread>();
  readonly #sessions = new Map<string, NawcProviderSession>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #listeners = new Set<AgentChangeListener>();

  constructor(input: {
    readonly provider: NawcProvider;
    readonly cwd: string;
    readonly skillsDir: string;
  }) {
    this.#provider = input.provider;
    this.#cwd = input.cwd;
    this.#skillsDir = input.skillsDir;
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

  subscribe(listener: AgentChangeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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
    this.#notify(thread.id);
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
    this.#notify(thread.id);
  }

  async *sendTurn(input: SendTurnInput): AsyncIterable<ProviderEvent> {
    const thread = this.#requireThread(input.threadId);
    if (thread.status === "running" || this.#controllers.has(thread.id))
      throw new Error("This agent thread is already running");
    thread.model = input.model ?? thread.model;
    thread.reasoningEffort = input.reasoningEffort ?? thread.reasoningEffort;
    thread.options = input.options ?? thread.options;
    thread.mode = input.mode ?? thread.mode;
    const references = prepareTurnReferences(input.references, thread.attachedReferenceKeys);
    const turn = startAgentTurn(thread, {
      text: input.prompt,
      references: input.references.map(displayReference),
      attachments: input.attachments,
    });
    this.#notify(thread.id);
    const controller = new AbortController();
    this.#controllers.set(thread.id, controller);
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
        references,
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
        this.#notify(thread.id);
        if (event.type === "thread.started") {
          session = { ...session, providerThreadId: event.threadId };
          this.#sessions.set(thread.id, session);
        }
        if (event.type === "turn.completed" || event.type === "done") completed = true;
        yield { ...event, turnId: event.turnId ?? turn.id };
      }
      if (!completed) {
        const event: ProviderEvent = controller.signal.aborted
          ? { type: "turn.interrupted", turnId: turn.id }
          : { type: "turn.completed", turnId: turn.id };
        projectProviderEvent(thread, turn.id, event);
        this.#notify(thread.id);
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
      this.#notify(thread.id);
      yield event;
    } finally {
      this.#controllers.delete(thread.id);
    }
  }

  async interrupt(threadId: string): Promise<void> {
    const thread = this.#threads.get(threadId);
    const turn = thread?.turns.findLast((item) => item.status === "running");
    if (thread?.status === "running" && turn) {
      projectProviderEvent(thread, turn.id, { type: "turn.interrupted", turnId: turn.id });
      this.#notify(thread.id);
    }
    const session = this.#sessions.get(threadId);
    this.#controllers.get(threadId)?.abort();
    if (session) await this.#provider.interrupt?.(session);
  }

  async respondToRequest(threadId: string, requestId: string, decision: string): Promise<void> {
    const thread = this.#requireThread(threadId);
    const session = this.#sessions.get(threadId);
    if (!session || !this.#provider.respondToRequest)
      throw new Error("This provider cannot respond to interactive requests");
    await this.#provider.respondToRequest(session, requestId, decision);
    const request = thread.requests.find((item) => item.id === requestId);
    if (request)
      projectProviderEvent(thread, request.turnId, {
        type: "request.resolved",
        requestId,
        decision,
      });
    this.#notify(thread.id);
  }

  async close(): Promise<void> {
    for (const threadId of this.#controllers.keys()) await this.interrupt(threadId);
    for (const session of this.#sessions.values()) await this.#provider.closeSession?.(session);
  }

  #requireThread(id: string): AgentThread {
    const thread = this.#threads.get(id);
    if (!thread) throw new Error(`Unknown agent thread: ${id}`);
    return thread;
  }

  #notify(threadId: string): void {
    const thread = this.#threads.get(threadId);
    for (const listener of this.#listeners) listener(threadId, thread);
  }
}
