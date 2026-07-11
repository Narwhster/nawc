import { describe, expect, it } from "vitest";
import { parseCodexEvent } from "../src/index.ts";

describe("Codex JSONL", () => {
  it("maps thread and message events", () => {
    expect(parseCodexEvent('{"type":"thread.started","thread_id":"abc"}')).toEqual({
      type: "thread.started",
      threadId: "abc",
    });
    expect(
      parseCodexEvent('{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}'),
    ).toEqual({ type: "message", text: "Done" });
  });

  it("turns malformed output into a visible error", () => {
    expect(parseCodexEvent("nope")).toEqual({
      type: "error",
      message: "Codex emitted invalid JSON: nope",
    });
  });
});
