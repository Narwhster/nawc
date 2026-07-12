import { expect, it } from "vitest";
import { parseCodexEvent } from "@nawc/provider-codex";

export function renderProviderEvent(line: string) {
  return parseCodexEvent(line);
}

it("preserves provider-specific event payloads", () => {
  expect(renderProviderEvent('{"type":"approval.requested","action":"write"}')).toEqual({
    type: "approval.requested",
    action: "write",
  });
});
