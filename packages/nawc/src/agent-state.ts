import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { AgentThread } from "./agent-thread.ts";

const agentWarningSchema = z.object({
  message: z.string(),
  turnId: z.string().optional(),
});

const SAVE_DEBOUNCE_MS = 100;

export class AgentState {
  readonly #database: DatabaseSync;
  readonly #saveStatement;
  readonly #deleteStatement;
  readonly #pending = new Map<string, AgentThread>();
  readonly #timers = new Map<string, NodeJS.Timeout>();

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.#database = new DatabaseSync(file);
    this.#database.exec(
      "CREATE TABLE IF NOT EXISTS agent_threads (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
    );
    this.#saveStatement = this.#database.prepare(
      "INSERT INTO agent_threads (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    );
    this.#deleteStatement = this.#database.prepare("DELETE FROM agent_threads WHERE id = ?");
  }

  load(): AgentThread[] {
    const rows = this.#database.prepare("SELECT data FROM agent_threads").all();
    return rows.map((row) => {
      if (typeof row.data !== "string") throw new Error("Invalid persisted agent thread");
      const thread = JSON.parse(row.data) as AgentThread;
      return {
        ...thread,
        warnings: thread.warnings
          .map((w) => agentWarningSchema.safeParse(w))
          .filter((r) => r.success)
          .map((r) => r.data),
      };
    });
  }

  save(thread: AgentThread): void {
    this.#pending.set(thread.id, thread);
    const existing = this.#timers.get(thread.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.#timers.delete(thread.id);
      this.#flushOne(thread.id);
    }, SAVE_DEBOUNCE_MS);
    timer.unref?.();
    this.#timers.set(thread.id, timer);
  }

  #flushOne(threadId: string): void {
    const thread = this.#pending.get(threadId);
    if (!thread) return;
    this.#pending.delete(threadId);
    this.#saveStatement.run(thread.id, JSON.stringify(thread));
  }

  delete(threadId: string): void {
    const timer = this.#timers.get(threadId);
    if (timer) {
      clearTimeout(timer);
      this.#timers.delete(threadId);
    }
    this.#pending.delete(threadId);
    this.#deleteStatement.run(threadId);
  }

  close(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    for (const threadId of Array.from(this.#pending.keys())) this.#flushOne(threadId);
    this.#database.close();
  }
}
