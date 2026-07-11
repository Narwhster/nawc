import type { NawcProvider } from "@nawc/config";

export function myAgent(): NawcProvider {
  return {
    name: "my-agent",
    slashCommands: [{ name: "review", description: "Review the selection" }],
    async *prompt({ prompt }) {
      yield { type: "thread.started", threadId: crypto.randomUUID() };
      // Invoke the harness in the supplied cwd and translate its output here.
      yield { type: "message", text: `Received ${prompt}` };
      yield { type: "done" };
    },
  };
}
