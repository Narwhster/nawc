import { describe, expect, it } from "vitest";
import { mapPiEvent, pi, piModels } from "../src/index.ts";

describe("Pi provider", () => {
  it("exposes provider metadata", () => {
    const provider = pi();
    expect(provider.name).toBe("pi");
    expect(provider.capabilities).toEqual([
      "attachments",
      "resume",
      "interrupt",
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
