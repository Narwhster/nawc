import { describe, expect, it } from "vitest";
import {
  codexApprovalChoices,
  codexApprovalDecision,
  codexPermissionChoices,
  codexPermissionResponse,
  mapCodexAppServerEvent,
  parseCodexEvent,
  parseCodexCollaborationModes,
  parseCodexModelsResponse,
  parseCodexSkillsResponse,
} from "../src/index.ts";

describe("Codex JSONL", () => {
  it("preserves the app server's available approval decisions", () => {
    const amendment = {
      acceptWithExecpolicyAmendment: { execpolicy_amendment: ["git", "status"] },
    };
    const params = {
      availableDecisions: ["accept", "decline", amendment],
    };

    expect(codexApprovalChoices(params)).toEqual([
      { id: "accept", label: "Accept" },
      { id: "decline", label: "Decline" },
      {
        id: JSON.stringify(amendment),
        label: "Accept With Execpolicy Amendment",
      },
    ]);
    expect(codexApprovalDecision(params, JSON.stringify(amendment))).toEqual(amendment);
  });

  it("maps app-server approval choices and reasons", () => {
    expect(
      mapCodexAppServerEvent({
        id: 16,
        method: "item/commandExecution/requestApproval",
        params: {
          command: "vp test",
          reason: "Needs network access",
          availableDecisions: ["accept", "decline"],
        },
      }),
    ).toEqual({
      type: "request.opened",
      requestId: "16",
      requestKind: "item/commandExecution/requestApproval",
      title: "vp test",
      details: "Needs network access",
      choices: [
        { id: "accept", label: "Accept" },
        { id: "decline", label: "Decline" },
      ],
    });
  });

  it("preserves requested Codex permission profiles in scoped responses", () => {
    const params = {
      permissions: { network: { enabled: true } },
      reason: "Download dependencies",
    };
    const choices = codexPermissionChoices(params);

    expect(choices.map(({ label }) => label)).toEqual([
      "Allow for turn",
      "Allow for turn with strict auto review",
      "Allow for session",
      "Decline",
    ]);
    expect(codexPermissionResponse(params, choices[2].id)).toEqual({
      permissions: params.permissions,
      scope: "session",
    });
    expect(
      mapCodexAppServerEvent({
        id: 18,
        method: "item/permissions/requestApproval",
        params,
      }),
    ).toMatchObject({
      type: "request.opened",
      requestId: "18",
      title: "Codex requests additional permissions",
      details: "Download dependencies",
      choices,
    });
  });

  it("reads provider-advertised collaboration modes", () => {
    expect(
      parseCodexCollaborationModes({
        data: [
          { name: "Plan", mode: "plan", model: null, reasoning_effort: "medium" },
          { name: "Pair", mode: null, model: "gpt" },
        ],
      }),
    ).toEqual([
      { name: "Plan", mode: "plan", reasoningEffort: "medium" },
      { name: "Pair", model: "gpt" },
    ]);
  });

  it("maps app-server user-input requests to question choices", () => {
    expect(
      mapCodexAppServerEvent({
        id: 17,
        method: "item/tool/requestUserInput",
        params: {
          questions: [
            {
              id: "framework",
              header: "Framework",
              question: "Which framework?",
              isOther: true,
              options: [
                { label: "React", description: "Use React" },
                { label: "Vue", description: "Use Vue" },
              ],
            },
          ],
        },
      }),
    ).toEqual({
      type: "request.opened",
      requestId: "17",
      requestKind: "question",
      title: "Framework",
      details: "Which framework?",
      choices: ["React", "Vue"],
      allowCustom: true,
    });
  });

  it("maps thread and message events", () => {
    expect(parseCodexEvent('{"type":"thread.started","thread_id":"abc"}')).toEqual({
      type: "thread.started",
      threadId: "abc",
    });
    expect(
      parseCodexEvent('{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}'),
    ).toEqual({ type: "message.completed", text: "Done" });
  });

  it("preserves tool lifecycle, usage, and unknown native events", () => {
    expect(
      parseCodexEvent(
        '{"type":"item.completed","item":{"id":"tool-1","type":"command_execution","command":"vp test","aggregated_output":"passed"}}',
      ),
    ).toEqual({
      type: "tool.completed",
      itemId: "tool-1",
      tool: "command_execution",
      title: "vp test",
      status: "completed",
      output: "passed",
    });
    expect(parseCodexEvent('{"type":"future.event","value":1}')).toEqual({
      type: "unknown",
      sourceType: "future.event",
      payload: { type: "future.event", value: 1 },
    });
  });

  it("turns malformed output into a visible error", () => {
    expect(parseCodexEvent("nope")).toEqual({
      type: "error",
      message: "Codex emitted invalid JSON: nope",
    });
  });

  it("maps Codex token count updates without completing the turn", () => {
    expect(
      parseCodexEvent(
        '{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1200,"output_tokens":80,"total_tokens":1280},"model_context_window":258400}}}',
      ),
    ).toEqual({
      type: "context.updated",
      usage: { input: 1200, output: 80, total: 1280, contextWindow: 258400 },
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
          {
            id: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Faster" },
              { reasoningEffort: "high", description: "Deeper" },
            ],
            defaultReasoningEffort: "low",
            isDefault: true,
          },
          { id: "hidden", displayName: "Hidden", hidden: true },
        ],
      }),
    ).toEqual([
      {
        id: "gpt-5.5",
        name: "GPT-5.5",
        description: "Frontier model",
        reasoningEfforts: [
          { id: "low", description: "Faster" },
          { id: "high", description: "Deeper" },
        ],
        defaultReasoningEffort: "low",
        isDefault: true,
      },
    ]);
  });

  it("maps Codex speed tiers to a provider-neutral model option", () => {
    expect(
      parseCodexModelsResponse({
        data: [
          {
            id: "gpt",
            displayName: "GPT",
            supportedReasoningEfforts: [],
            additionalSpeedTiers: ["fast"],
          },
        ],
      })[0]?.options,
    ).toEqual([
      {
        id: "serviceTier",
        label: "Service tier",
        type: "select",
        choices: [
          { id: "default", label: "Standard" },
          { id: "fast", label: "Fast" },
        ],
        defaultValue: "default",
      },
    ]);
  });
});
