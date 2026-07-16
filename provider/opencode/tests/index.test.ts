import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOpencodeConfigContent,
  flattenOpencodeModels,
  parseOpencodeEvent,
  parseOpencodeModels,
  parseOpencodeSkillFile,
  parseOpencodeVerboseModels,
} from "../src/index.ts";

describe("OpenCode JSONL", () => {
  it("maps step_start to a turn lifecycle event", () => {
    expect(
      parseOpencodeEvent(
        '{"type":"step_start","timestamp":1,"sessionID":"ses_1","part":{"id":"prt_0","messageID":"msg_0","sessionID":"ses_1","type":"step-start"}}',
      ),
    ).toEqual({ type: "turn.started" });
  });

  it("maps completed text parts to a finished message", () => {
    expect(
      parseOpencodeEvent(
        '{"type":"text","timestamp":1,"sessionID":"ses_1","part":{"id":"prt_3","messageID":"msg_1","type":"text","text":"Hello!","time":{"start":1,"end":2}}}',
      ),
    ).toEqual({ type: "message.completed", itemId: "prt_3", text: "Hello!" });
  });

  it("maps tool lifecycle, including failures", () => {
    expect(
      parseOpencodeEvent(
        '{"type":"tool_use","timestamp":1,"sessionID":"ses_1","part":{"id":"prt_1","callID":"call_1","tool":"bash","state":{"status":"completed","output":"passed","title":"Running vp test","time":{"start":1,"end":2}}}}',
      ),
    ).toEqual({
      type: "tool.completed",
      itemId: "call_1",
      tool: "bash",
      title: "Running vp test",
      status: "completed",
      output: "passed",
    });
    expect(
      parseOpencodeEvent(
        '{"type":"tool_use","timestamp":1,"sessionID":"ses_1","part":{"id":"prt_2","callID":"call_2","tool":"edit","state":{"status":"error","error":"permission denied","title":"Editing file.ts"}}}',
      ),
    ).toEqual({
      type: "tool.completed",
      itemId: "call_2",
      tool: "edit",
      title: "Editing file.ts",
      status: "failed",
    });
  });

  it("maps a final step_finish with token usage and drops intermediate steps", () => {
    expect(
      parseOpencodeEvent(
        '{"type":"step_finish","timestamp":1,"sessionID":"ses_1","part":{"id":"prt_4","type":"step-finish","reason":"stop","cost":0.01,"tokens":{"input":10,"output":20,"reasoning":5,"cache":{"read":1,"write":2}}}}',
      ),
    ).toEqual({ type: "turn.completed", usage: { input: 10, output: 20 } });
    expect(
      parseOpencodeEvent(
        '{"type":"step_finish","timestamp":1,"sessionID":"ses_1","part":{"id":"prt_5","type":"step-finish","reason":"tool-calls"}}',
      ),
    ).toBeUndefined();
  });

  it("maps error events using the embedded message", () => {
    expect(
      parseOpencodeEvent(
        '{"type":"error","timestamp":1,"sessionID":"ses_1","error":{"name":"ApiError","data":{"message":"rate limited"}}}',
      ),
    ).toEqual({ type: "error", message: "rate limited" });
  });

  it("preserves unknown native events", () => {
    expect(
      parseOpencodeEvent(
        '{"type":"reasoning","timestamp":1,"part":{"type":"reasoning","text":"..."}}',
      ),
    ).toEqual({
      type: "unknown",
      sourceType: "reasoning",
      payload: { type: "reasoning", timestamp: 1, part: { type: "reasoning", text: "..." } },
    });
  });

  it("turns malformed output into a visible error", () => {
    expect(parseOpencodeEvent("nope")).toEqual({
      type: "error",
      message: "OpenCode emitted invalid JSON: nope",
    });
  });

  it("parses the opencode models listing into model slugs", () => {
    expect(
      parseOpencodeModels(
        "opencode/big-pickle\nopencode/claude-sonnet-4\nopenrouter/x-ai/grok-4.5\n\n  opencode/gpt-5  \nnot-a-model\n",
      ),
    ).toEqual([
      { id: "opencode/big-pickle", name: "opencode/big-pickle" },
      { id: "opencode/claude-sonnet-4", name: "opencode/claude-sonnet-4" },
      { id: "openrouter/x-ai/grok-4.5", name: "openrouter/x-ai/grok-4.5" },
      { id: "opencode/gpt-5", name: "opencode/gpt-5" },
    ]);
  });
});

describe("OpenCode skill configuration", () => {
  it("parses native skill frontmatter", () => {
    expect(
      parseOpencodeSkillFile(
        "---\nname: native\ndescription: Use for native work.\n---\n# Native",
        "/home/user/.agents/skills/native/SKILL.md",
      ),
    ).toEqual({
      name: "native",
      path: "/home/user/.agents/skills/native/SKILL.md",
      shortDescription: "OpenCode skill",
      description: "Use for native work.",
    });
  });

  it("rejects skills without valid frontmatter or a matching folder", () => {
    expect(
      parseOpencodeSkillFile("# No frontmatter", "/home/user/.agents/skills/native/SKILL.md"),
    ).toBeUndefined();
    expect(
      parseOpencodeSkillFile(
        "---\nname: other\ndescription: Mismatch\n---\n# Other",
        "/home/user/.agents/skills/native/SKILL.md",
      ),
    ).toBeUndefined();
  });

  it("adds NAWC's generated skill directory to OpenCode's configured paths", () => {
    expect(buildOpencodeConfigContent(".skills")).toBe(
      JSON.stringify({ skills: { paths: [path.resolve(".skills")] } }),
    );
  });

  it("preserves existing inline config and skill paths", () => {
    expect(
      buildOpencodeConfigContent(
        ".skills",
        JSON.stringify({ model: "openai/gpt-5", skills: { paths: ["shared-skills"] } }),
      ),
    ).toBe(
      JSON.stringify({
        model: "openai/gpt-5",
        skills: { paths: ["shared-skills", path.resolve(".skills")] },
      }),
    );
  });

  it("leaves invalid existing inline config untouched", () => {
    expect(buildOpencodeConfigContent(".skills", "{ not json")).toBeUndefined();
  });
});

describe("OpenCode verbose models", () => {
  it("parses verbose output with variants", () => {
    const output = `opencode/claude-sonnet-5
{
  "id": "claude-sonnet-5",
  "providerID": "anthropic",
  "name": "Claude Sonnet 5",
  "variants": {
    "low": {},
    "medium": {},
    "high": {},
    "xhigh": {},
    "max": {}
  }
}
opencode/gpt-5
{
  "id": "gpt-5",
  "providerID": "openai",
  "name": "GPT-5",
  "variants": {
    "minimal": {},
    "low": {},
    "medium": {},
    "high": {}
  }
}`;
    expect(parseOpencodeVerboseModels(output)).toEqual([
      {
        id: "anthropic/claude-sonnet-5",
        name: "Claude Sonnet 5",
        reasoningEfforts: [
          { id: "low" },
          { id: "medium" },
          { id: "high" },
          { id: "xhigh" },
          { id: "max" },
        ],
        defaultReasoningEffort: "high",
      },
      {
        id: "openai/gpt-5",
        name: "GPT-5",
        reasoningEfforts: [{ id: "minimal" }, { id: "low" }, { id: "medium" }, { id: "high" }],
        defaultReasoningEffort: "medium",
      },
    ]);
  });

  it("parses models without variants", () => {
    const output = `opencode/big-pickle
{
  "id": "big-pickle",
  "providerID": "opencode",
  "name": "Big Pickle",
  "variants": {}
}`;
    expect(parseOpencodeVerboseModels(output)).toEqual([
      { id: "opencode/big-pickle", name: "Big Pickle" },
    ]);
  });

  it("falls back to slug id on invalid JSON", () => {
    const output = `opencode/broken
not valid json`;
    expect(parseOpencodeVerboseModels(output)).toEqual([
      { id: "opencode/broken", name: "opencode/broken" },
    ]);
  });
});

describe("OpenCode provider inventory", () => {
  it("flattens connected providers and preserves model variants", () => {
    expect(
      flattenOpencodeModels({
        connected: ["openai"],
        default: {},
        all: [
          {
            id: "openai",
            name: "OpenAI",
            source: "env",
            env: [],
            options: {},
            models: {
              "gpt-5": {
                id: "gpt-5",
                providerID: "openai",
                name: "GPT-5",
                api: { id: "gpt-5", url: "https://example.com", npm: "example" },
                capabilities: {
                  temperature: true,
                  reasoning: true,
                  attachment: false,
                  toolcall: true,
                  input: { text: true, audio: false, image: false, video: false, pdf: false },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                cost: { input: 1, output: 2, cache: { read: 0, write: 0 } },
                limit: { context: 1000, output: 100 },
                status: "active",
                options: {},
                headers: {},
                release_date: "2026-01-01",
                variants: { low: {}, medium: {}, high: {} },
              },
            },
          },
          {
            id: "anthropic",
            name: "Anthropic",
            source: "env",
            env: [],
            options: {},
            models: {},
          },
        ],
      }),
    ).toEqual([
      {
        id: "openai/gpt-5",
        name: "GPT-5",
        reasoningEfforts: [{ id: "low" }, { id: "medium" }, { id: "high" }],
        defaultReasoningEffort: "medium",
      },
    ]);
  });
});
