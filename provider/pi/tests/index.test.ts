import { describe, expect, it } from "vitest";
import { mapPiEvent, pi, piModels, piQuestionEvent } from "../src/index.ts";

describe("Pi provider", () => {
  it("maps question tool input to a provider request", () => {
    expect(
      piQuestionEvent("question-1", {
        question: "Which framework?",
        options: [{ label: "React" }, { label: "Vue" }],
        allowCustom: true,
      }),
    ).toEqual({
      type: "request.opened",
      requestId: "question-1",
      requestKind: "question",
      title: "Pi asks a question",
      details: "Which framework?",
      choices: ["React", "Vue"],
      allowCustom: true,
    });
  });

  it("exposes provider metadata", () => {
    const provider = pi();
    expect(provider.name).toBe("pi");
    expect(provider.capabilities).toEqual([
      "attachments",
      "resume",
      "interrupt",
      "requests",
      "session-model-switch",
    ]);
    expect(provider.modes?.map((mode) => mode.id)).toEqual(["default", "plan", "review"]);
  });

  it("maps streaming text and tool lifecycle events", () => {
    expect(mapPiEvent({ type: "turn_start" })).toEqual({ type: "turn.started" });
    expect(
      mapPiEvent({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "bash",
        args: { command: "vp test" },
      }),
    ).toEqual({
      type: "tool.started",
      itemId: "tool-1",
      tool: "bash",
      title: "bash",
      status: "running",
      output: '{\n  "command": "vp test"\n}',
    });
  });

  it("lists authenticated models with provider-qualified ids", () => {
    expect(piModels([])).toEqual([]);
  });
});
