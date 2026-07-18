import { expect, it } from "vitest";
import clientPlugin from "@nawc/core/client";

export function pluginUiContributions() {
  return clientPlugin as typeof clientPlugin & {
    readonly ui?: { readonly toolbar?: readonly string[]; readonly panels?: readonly string[] };
  };
}

it("collects app-level contributions from a client plugin", () => {
  expect(pluginUiContributions().ui?.toolbar ?? []).toContain("review");
  expect(pluginUiContributions().ui?.panels ?? []).toContain("findings");
});
