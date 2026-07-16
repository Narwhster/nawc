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

  it("marks a turn interrupted when the provider stream ends after abort", async () => {
    const interruptibleProvider: NawcProvider = {
      name: "interruptible",
      async startSession({ providerThreadId }) {
        return { id: "session-1", providerThreadId };
      },
      async *sendTurn(_session, { signal }) {
        yield { type: "turn.started" };
        if (signal?.aborted) return;
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    };
    const manager = new AgentManager({
      provider: interruptibleProvider,
      cwd: process.cwd(),
      skillsDir: process.cwd(),
    });
    const thread = await manager.createThread({});
    const stream = manager.sendTurn({
      threadId: thread.id,
      prompt: "interrupt me",
      references: [],
    });
    const iterator = stream[Symbol.asyncIterator]();

    await iterator.next();
    await manager.interrupt(thread.id);
    expect(thread.status).toBe("idle");
    expect(thread.turns[0]?.status).toBe("interrupted");
    const result = await iterator.next();

    expect(result.done).toBe(false);
    expect(result.value).toMatchObject({ type: "turn.interrupted" });
  });

  it("attaches note content only on the first turn in a thread", async () => {
    const seen: { prompt: string; references: unknown }[] = [];
    const trackingProvider: NawcProvider = {
      name: "tracking",
      async *sendTurn(_session, input) {
        seen.push({ prompt: input.prompt, references: input.references });
        yield { type: "turn.completed" };
      },
    };
    const manager = new AgentManager({
      provider: trackingProvider,
      cwd: process.cwd(),
      skillsDir: process.cwd(),
    });
    const thread = await manager.createThread({});
    const note = {
      type: "note" as const,
      path: "Note.html",
      content: "<p>full body</p>",
    };
    const file = { type: "file" as const, path: "src/a.ts" };

    for await (const _event of manager.sendTurn({
      threadId: thread.id,
      prompt: "first",
      references: [note, file],
    }))
      void _event;
    for await (const _event of manager.sendTurn({
      threadId: thread.id,
      prompt: "second",
      references: [note, file],
    }))
      void _event;

    expect(seen).toEqual([
      {
        prompt: "first",
        references: [note, file],
      },
      {
        prompt: "second",
        references: [{ type: "note", path: "Note.html" }],
      },
    ]);
    expect(thread.attachedReferenceKeys).toEqual(["note:Note.html", "file:src/a.ts"]);
    expect(thread.messages[0]?.references).toEqual([
      { type: "note", path: "Note.html" },
      { type: "file", path: "src/a.ts" },
    ]);
    expect(JSON.stringify(thread.messages)).not.toContain("full body");
  });
});
