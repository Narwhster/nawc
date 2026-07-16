import { describe, expect, it } from "vite-plus/test";
import {
  cursor,
  cursorPermissionOptionId,
  parseCursorEvent,
  parseCursorModelsResponse,
} from "../src/index.ts";

describe("Cursor ACP model discovery", () => {
  it("maps available models and parameterized config options", () => {
    expect(
      parseCursorModelsResponse({
        models: [
          {
            value: "gpt-5.4",
            name: "GPT-5.4",
            configOptions: [
              {
                id: "reasoning",
                name: "Reasoning",
                type: "select",
                currentValue: "medium",
                options: [
                  { value: "low", name: "Low" },
                  { value: "medium", name: "Medium" },
                ],
              },
              {
                id: "fast",
                name: "Fast",
                type: "boolean",
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        reasoningEfforts: [
          { id: "low", description: "Low" },
          { id: "medium", description: "Medium" },
        ],
        defaultReasoningEffort: "medium",
        options: [{ id: "fastMode", label: "Fast mode", type: "boolean" }],
      },
    ]);
  });
});

describe("Cursor ACP event mapping", () => {
  it("maps assistant chunks, tool updates, and plans", () => {
    expect(
      parseCursorEvent("session/update", {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello" },
        },
      }),
    ).toEqual({ type: "message.delta", text: "Hello" });

    expect(
      parseCursorEvent("session/update", {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          kind: "execute",
          title: "Terminal",
          status: "completed",
          rawOutput: { stdout: "ok" },
        },
      }),
    ).toEqual({
      type: "tool.updated",
      tool: "execute",
      title: "Terminal",
      status: "completed",
      itemId: "tool-1",
      output: '{"stdout":"ok"}',
    });

    expect(
      parseCursorEvent("session/update", {
        update: {
          sessionUpdate: "plan",
          entries: [
            { content: "Inspect repository", status: "completed" },
            { content: "Implement provider", status: "in_progress" },
          ],
        },
      }),
    ).toEqual({
      type: "plan.updated",
      markdown: "- [x] Inspect repository\n- [ ] Implement provider",
    });
  });
});

describe("Cursor provider metadata", () => {
  it("exposes the ACP capabilities and modes", () => {
    const provider = cursor({ executable: "cursor-agent" });
    expect(provider.name).toBe("cursor");
    expect(provider.capabilities).toContain("resume");
    expect(provider.capabilities).toContain("requests");
    expect(provider.modes?.map((mode) => mode.id)).toEqual(["default", "plan", "review"]);
  });
});

describe("Cursor ACP permissions", () => {
  const params = {
    options: [
      { optionId: "allow-this-command", name: "Allow", kind: "allow_once" },
      { optionId: "allow-this-session", name: "Allow for session", kind: "allow_always" },
      { optionId: "reject-command", name: "Reject", kind: "reject_once" },
    ],
  };

  it.each([
    ["accept", "allow-this-command"],
    ["acceptForSession", "allow-this-session"],
    ["decline", "reject-command"],
  ])("maps the generic %s decision to the agent-provided option ID", (decision, optionId) => {
    expect(cursorPermissionOptionId(params, decision)).toBe(optionId);
  });
});
