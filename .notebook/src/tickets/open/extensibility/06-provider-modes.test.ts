import { expect, it } from "vitest";
import { codex } from "@nawc/provider-codex";

type Provider = ReturnType<typeof codex>;

export function providerModes() {
  return codex() as Provider & {
    readonly modes?: readonly { readonly id: string; readonly label: string }[];
  };
}

it("exposes provider-defined prompt modes", () => {
  expect(providerModes().modes ?? []).toContainEqual({ id: "review", label: "Review" });
});
