import { describe, expect, it } from "vitest";
import { createPiUiBridge, mapPiEvent, pi, piModels, piQuestionEvent } from "../src/index.ts";

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

  it("bridges Pi extension dialogs without changing their policy choices", async () => {
    const events: unknown[] = [];
    const bridge = createPiUiBridge((event) => events.push(event));

    const selected = bridge.select("Allow command?", ["Allow once", "Always", "Block"]);
    expect(events).toEqual([
      {
        type: "request.opened",
        requestId: expect.any(String),
        requestKind: "pi/select",
        title: "Allow command?",
        choices: ["Allow once", "Always", "Block"],
      },
    ]);
    const request = events[0] as { requestId: string };
    expect(bridge.respond(request.requestId, "Always")).toBe(true);
    await expect(selected).resolves.toBe("Always");
  });

  it("maps Pi confirmations and cancellation to their native return values", async () => {
    const events: { requestId: string; type: string }[] = [];
    const bridge = createPiUiBridge((event) =>
      events.push(event as { requestId: string; type: string }),
    );

    const confirmed = bridge.confirm("Dangerous command", "Run rm -rf?");
    expect(bridge.respond(events[0].requestId, "Confirm")).toBe(true);
    await expect(confirmed).resolves.toBe(true);

    const cancelled = bridge.confirm("Dangerous command", "Run rm -rf?");
    bridge.cancelAll();
    await expect(cancelled).resolves.toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "request.resolved",
      requestId: events[1].requestId,
    });
  });

  it("returns custom input and dismisses timed-out dialogs", async () => {
    const events: { requestId: string; type: string }[] = [];
    const bridge = createPiUiBridge((event) =>
      events.push(event as { requestId: string; type: string }),
    );

    const input = bridge.input("Reason", "Explain why");
    expect(bridge.respond(events[0].requestId, "Needed for the build")).toBe(true);
    await expect(input).resolves.toBe("Needed for the build");

    const timedOut = bridge.select("Choose quickly", ["Yes", "No"], { timeout: 0 });
    await expect(timedOut).resolves.toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      type: "request.resolved",
      requestId: events[1].requestId,
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
