import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { NawcProvider } from "../../../packages/config/src/agent.ts";
import { AgentManager } from "../../../packages/nawc/src/agent-manager.ts";
import { createProject } from "../../../packages/create-nawc/src/create.ts";

it("adds the runtime data directory to the generated notebook Git ignore file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nawc-chat-state-"));
  const notebookDir = path.join(root, "notebook");
  try {
    await createProject({
      directory: notebookDir,
      packageManager: "pnpm",
      install: false,
    });

    await expect(readFile(path.join(notebookDir, ".gitignore"), "utf8")).resolves.toContain(
      ".nawc/",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("restores a complete conversation after the agent manager restarts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nawc-chat-persistence-"));
  const statePath = path.join(root, ".nawc", "state.sqlite");
  const provider: NawcProvider = {
    name: "persistence-probe",
    async *sendTurn() {
      yield { type: "thread.started", threadId: "provider-thread-1" };
      yield { type: "plan.updated", markdown: "Inspect the project" };
      yield {
        type: "tool.started",
        itemId: "activity-1",
        tool: "shell",
        title: "List files",
      };
      yield {
        type: "tool.completed",
        itemId: "activity-1",
        tool: "shell",
        title: "List files",
        status: "completed",
        output: "src/index.ts",
      };
      yield { type: "warning", message: "The provider returned a partial result." };
      yield { type: "message", itemId: "message-1", text: "I found the entry point." };
      yield { type: "turn.completed" };
    },
  };
  const options = { provider, cwd: root, skillsDir: root, statePath };
  try {
    const manager = new AgentManager(options);
    const thread = await manager.createThread({});
    for await (const _event of manager.sendTurn({
      threadId: thread.id,
      prompt: "Inspect the project",
      references: [],
    }))
      void _event;

    const restarted = new AgentManager(options);
    const restored = restarted.getThread(thread.id);
    expect(restored).toMatchObject({
      id: thread.id,
      providerThreadId: "provider-thread-1",
      status: "idle",
      turns: [{ status: "completed", plan: "Inspect the project" }],
      messages: [
        { role: "user", text: "Inspect the project" },
        { role: "assistant", text: "I found the entry point." },
      ],
      activities: [
        { id: "activity-1", status: "completed", output: "src/index.ts" },
      ],
      warnings: ["The provider returned a partial result."],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("restores a running turn as interrupted after the agent manager restarts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nawc-chat-interrupted-"));
  const statePath = path.join(root, ".nawc", "state.sqlite");
  const provider: NawcProvider = {
    name: "interrupted-probe",
    async *sendTurn() {
      yield { type: "turn.started" };
      await new Promise<void>(() => undefined);
    },
  };
  const options = { provider, cwd: root, skillsDir: root, statePath };
  try {
    const manager = new AgentManager(options);
    const thread = await manager.createThread({});
    const iterator = manager.sendTurn({
      threadId: thread.id,
      prompt: "The server will restart",
      references: [],
    })[Symbol.asyncIterator]();
    await iterator.next();

    const restarted = new AgentManager(options);
    expect(restarted.getThread(thread.id)).toMatchObject({
      status: "idle",
      turns: [{ status: "interrupted" }],
    });
    await manager.interrupt(thread.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
