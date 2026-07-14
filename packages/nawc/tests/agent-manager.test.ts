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
  it("resumes one provider thread across turns in memory", async () => {
    const manager = new AgentManager({
      provider,
      cwd: process.cwd(),
      skillsDir: process.cwd(),
    });
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
  });

  it("does not restore threads after a manager is recreated", async () => {
    const manager = new AgentManager({
      provider,
      cwd: process.cwd(),
      skillsDir: process.cwd(),
    });
    const thread = await manager.createThread({});

    const recreated = new AgentManager({
      provider,
      cwd: process.cwd(),
      skillsDir: process.cwd(),
    });
    expect(recreated.getThread(thread.id)).toBeUndefined();
  });
});
