import type { NawcProvider } from "@nawc/config";

export function myAgent(): NawcProvider {
  return {
    name: "my-agent",
    label: "My agent",
    capabilities: ["resume", "interrupt"],
    modes: [
      { id: "default", label: "Build" },
      { id: "review", label: "Review", description: "Inspect without editing" },
    ],
    async startSession({ providerThreadId }) {
      return { id: crypto.randomUUID(), providerThreadId };
    },
    async *sendTurn(session, { prompt }) {
      if (!session.providerThreadId)
        yield { type: "thread.started", threadId: crypto.randomUUID() };
      yield { type: "message.started", itemId: "answer" };
      yield { type: "message.delta", itemId: "answer", text: `Received ${prompt}` };
      yield { type: "message.completed", itemId: "answer" };
      yield { type: "turn.completed" };
    },
  };
}
