import { describe, expect, it, vi } from "vitest";
import type { ProviderEvent } from "@nawc/config";
import { drainAgentTurn } from "../src/agent-turn-drain.ts";

describe("drainAgentTurn", () => {
  it("continues draining the provider turn after the client disconnects", async () => {
    const consumed: ProviderEvent[] = [];
    async function* turn(): AsyncIterable<ProviderEvent> {
      const events: ProviderEvent[] = [
        { type: "turn.started" },
        { type: "message.delta", text: "working" },
        { type: "turn.completed" },
      ];
      for (const event of events) {
        consumed.push(event);
        yield event;
      }
    }
    const write = vi
      .fn<(event: ProviderEvent) => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("client disconnected"));

    await drainAgentTurn(turn(), write);

    expect(consumed).toHaveLength(3);
    expect(consumed.at(-1)).toMatchObject({ type: "turn.completed" });
    expect(write).toHaveBeenCalledTimes(2);
  });
});
