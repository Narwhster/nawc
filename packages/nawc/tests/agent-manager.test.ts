import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { NawcProvider } from "@nawc/config";
import { AgentManager } from "../src/agent-manager.ts";

const provider: NawcProvider = {
  name: "fake",
  capabilities: ["resume", "interrupt"],
  async startSession({ providerThreadId }) {
    return { id: "session-1", providerThreadId };
  },
  async *sendTurn(session, { prompt }) {
    if (!session.providerThreadId) yield { type: "thread.started", threadId: "native-thread" };
    yield { type: "message.delta", itemId: `reply:${prompt}`, text: `Reply to ${prompt}` };
    yield { type: "turn.completed" };
  },
};

describe("AgentManager", () => {
  it("resumes one provider thread across turns and reloads its projection", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "nawc-agent-"));
    const storageFile = path.join(directory, "threads.json");
    const manager = new AgentManager({
      provider,
      cwd: directory,
      skillsDir: directory,
      storageFile,
    });
    await manager.load();
    const thread = await manager.createThread({ model: "model-1", mode: "default" });
    for await (const _event of manager.sendTurn({
      threadId: thread.id,
      prompt: "one",
      references: [],
    }))
      void _event;
    for await (const _event of manager.sendTurn({
      threadId: thread.id,
      prompt: "two",
      references: [],
    }))
      void _event;

    expect(thread.providerThreadId).toBe("native-thread");
    expect(thread.messages.map((message) => message.text)).toEqual([
      "one",
      "Reply to one",
      "two",
      "Reply to two",
    ]);
    expect(JSON.parse(await readFile(storageFile, "utf8"))).toMatchObject({
      version: 1,
      threads: [{ id: thread.id }],
    });

    const restored = new AgentManager({
      provider,
      cwd: directory,
      skillsDir: directory,
      storageFile,
    });
    await restored.load();
    expect(restored.getThread(thread.id)?.messages).toHaveLength(4);
  });

  it("recovers an in-flight turn after a server restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "nawc-agent-recovery-"));
    const storageFile = path.join(directory, "threads.json");
    const manager = new AgentManager({
      provider,
      cwd: directory,
      skillsDir: directory,
      storageFile,
    });
    await manager.load();
    const thread = await manager.createThread({});
    thread.status = "running";
    thread.turns.push({
      id: "turn-running",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await writeFile(storageFile, JSON.stringify({ version: 1, threads: [thread] }));

    const restored = new AgentManager({
      provider,
      cwd: directory,
      skillsDir: directory,
      storageFile,
    });
    await restored.load();
    expect(restored.getThread(thread.id)).toMatchObject({
      status: "idle",
      turns: [{ status: "interrupted" }],
    });
  });
});
