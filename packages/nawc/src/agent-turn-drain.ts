import type { ProviderEvent } from "@nawc/config";

export async function drainAgentTurn(
  turn: AsyncIterable<ProviderEvent>,
  write: (event: ProviderEvent) => Promise<void>,
): Promise<void> {
  let connected = true;
  for await (const event of turn) {
    if (!connected) continue;
    try {
      await write(event);
    } catch {
      connected = false;
    }
  }
}
