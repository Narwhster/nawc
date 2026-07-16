import { describe, expect, it } from "vitest";
import { createAgentThread, projectProviderEvent, startAgentTurn } from "../src/agent-thread.ts";

describe("agent thread projection", () => {
  it("keeps user and streamed assistant messages in one turn", () => {
    const thread = createAgentThread("fake", "thread-1");
    const turn = startAgentTurn(thread, { text: "Explain this note", references: [] }, "turn-1");
    projectProviderEvent(thread, turn.id, {
      type: "message.delta",
      itemId: "assistant-1",
      text: "Hello ",
    });
    projectProviderEvent(thread, turn.id, {
      type: "message.delta",
      itemId: "assistant-1",
      text: "world",
    });
    projectProviderEvent(thread, turn.id, { type: "turn.completed" });

    expect(thread.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "Explain this note" },
      { role: "assistant", text: "Hello world" },
    ]);
    expect(thread.turns[0]?.status).toBe("completed");
  });

  it("updates one tool activity across its lifecycle and preserves unknown events", () => {
    const thread = createAgentThread("fake", "thread-1");
    const turn = startAgentTurn(thread, { text: "Run tests", references: [] }, "turn-1");
    projectProviderEvent(thread, turn.id, {
      type: "tool.started",
      itemId: "tool-1",
      tool: "command_execution",
      title: "vp test",
    });
    projectProviderEvent(thread, turn.id, {
      type: "tool.completed",
      itemId: "tool-1",
      tool: "command_execution",
      title: "vp test",
      status: "completed",
      output: "passed",
    });
    projectProviderEvent(thread, turn.id, {
      type: "unknown",
      sourceType: "provider.future-event",
      payload: { value: 1 },
    });

    expect(thread.activities).toMatchObject([
      { id: "tool-1", status: "completed", output: "passed" },
    ]);
    expect(thread.unknownEvents).toHaveLength(1);
  });

  it("records image metadata without persisting the encoded payload", () => {
    const thread = createAgentThread("fake", "thread-1");
    startAgentTurn(thread, {
      text: "Inspect this",
      references: [],
      attachments: [
        {
          type: "image",
          id: "image-1",
          name: "screen.png",
          mimeType: "image/png",
          sizeBytes: 4,
          dataUrl: "data:image/png;base64,dGVzdA==",
        },
      ],
    });
    expect(thread.messages[0]?.attachments).toEqual([
      {
        type: "image",
        id: "image-1",
        name: "screen.png",
        mimeType: "image/png",
        sizeBytes: 4,
      },
    ]);
    expect(JSON.stringify(thread)).not.toContain("dGVzdA==");
  });

  it("starts with no attached reference keys", () => {
    const thread = createAgentThread("fake", "thread-1");
    expect(thread.attachedReferenceKeys).toEqual([]);
  });

  it("keeps provider context metadata when a turn completes", () => {
    const thread = createAgentThread("codex", "thread-1");
    const turn = startAgentTurn(thread, { text: "Continue", references: [] }, "turn-1");
    projectProviderEvent(thread, turn.id, {
      type: "context.updated",
      usage: { total: 1_280, contextWindow: 258_400 },
    });
    projectProviderEvent(thread, turn.id, {
      type: "turn.completed",
      usage: { input: 1_200, output: 80 },
    });

    expect(thread.turns[0]?.usage).toEqual({
      total: 1_280,
      contextWindow: 258_400,
      input: 1_200,
      output: 80,
    });
  });
});
