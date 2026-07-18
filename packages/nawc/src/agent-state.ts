import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentThread } from "./agent-thread.ts";

export class AgentState {
  readonly #database: DatabaseSync;
  readonly #saveStatement;
  readonly #deleteStatement;

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
      return JSON.parse(row.data) as AgentThread;
    });
  }

  save(thread: AgentThread): void {
    this.#saveStatement.run(thread.id, JSON.stringify(thread));
  }

  delete(threadId: string): void {
    this.#deleteStatement.run(threadId);
  }

  close(): void {
    this.#database.close();
  }
}
