import { execa } from "execa";
import type { NawcProvider, ProviderEvent } from "@nawc/config";

type JsonObject = Record<string, unknown>;

export function parseCodexEvent(line: string): ProviderEvent | undefined {
  let event: JsonObject;
  try {
    event = JSON.parse(line) as JsonObject;
  } catch {
    return { type: "error", message: `Codex emitted invalid JSON: ${line}` };
  }

  if (event.type === "thread.started" && typeof event.thread_id === "string") {
    return { type: "thread.started", threadId: event.thread_id };
  }
  if (event.type === "error") {
    return {
      type: "error",
      message: typeof event.message === "string" ? event.message : "Codex failed",
    };
  }
  if (event.type === "turn.completed") return { type: "done" };

  const item =
    typeof event.item === "object" && event.item ? (event.item as JsonObject) : undefined;
  if (
    event.type === "item.completed" &&
    item?.type === "agent_message" &&
    typeof item.text === "string"
  ) {
    return { type: "message", text: item.text };
  }
  if (
    (event.type === "item.started" || event.type === "item.completed") &&
    item?.type === "command_execution"
  ) {
    return {
      type: "command",
      command: typeof item.command === "string" ? item.command : "",
      status: event.type === "item.started" ? "running" : "completed",
    };
  }
  return undefined;
}

export type CodexOptions = {
  readonly executable?: string;
  readonly model?: string;
  readonly sandbox?: "read-only" | "workspace-write";
};

export function codex(options: CodexOptions = {}): NawcProvider {
  return {
    name: "codex",
    async *prompt({ prompt, cwd, skillsDir }) {
      const skillInstruction = `\n\nNAWC plugin skills are available in ${skillsDir}. Read the relevant SKILL.md files before editing NAWC notes.`;
      const args = [
        "exec",
        "--json",
        "--color",
        "never",
        "--sandbox",
        options.sandbox ?? "workspace-write",
        "-C",
        cwd,
      ];
      if (options.model) args.push("--model", options.model);
      args.push("-");
      const child = execa(options.executable ?? "codex", args, {
        input: prompt + skillInstruction,
        reject: false,
      });
      if (!child.stdout) {
        yield { type: "error", message: "Codex did not expose an output stream" };
        return;
      }
      let buffer = "";
      for await (const chunk of child.stdout) {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = parseCodexEvent(line);
          if (parsed) yield parsed;
        }
      }
      if (buffer.trim()) {
        const parsed = parseCodexEvent(buffer);
        if (parsed) yield parsed;
      }
      const result = await child;
      if (result.exitCode !== 0)
        yield {
          type: "error",
          message: result.stderr || `Codex exited with code ${result.exitCode}`,
        };
    },
  };
}
