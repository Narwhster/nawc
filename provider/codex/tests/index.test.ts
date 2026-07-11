import { describe, expect, it } from "vitest";
import {
  parseCodexEvent,
  parseCodexModelsResponse,
  parseCodexSkillsResponse,
} from "../src/index.ts";

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

  it("maps the Codex skills/list response", () => {
    expect(
      parseCodexSkillsResponse({
        data: [
          {
            cwd: "/repo",
            skills: [
              {
                name: "review",
                path: "/home/user/.codex/skills/review/SKILL.md",
                scope: "user",
                enabled: true,
                interface: { displayName: "Review", shortDescription: "Review code" },
              },
              { name: "disabled", path: "/tmp/disabled/SKILL.md", enabled: false },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        name: "review",
        path: "/home/user/.codex/skills/review/SKILL.md",
        scope: "user",
        enabled: true,
        displayName: "Review",
        shortDescription: "Review code",
      },
      { name: "disabled", path: "/tmp/disabled/SKILL.md", enabled: false },
    ]);
  });

  it("maps visible Codex models", () => {
    expect(
      parseCodexModelsResponse({
        data: [
          { id: "gpt-5.5", displayName: "GPT-5.5", description: "Frontier model" },
          { id: "hidden", displayName: "Hidden", hidden: true },
        ],
      }),
    ).toEqual([{ id: "gpt-5.5", name: "GPT-5.5", description: "Frontier model" }]);
  });
});
