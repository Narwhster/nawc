import { expect, it } from "vitest";
import { serializeHtml } from "@nawc/ui/lib/serialize";

export function serializeWithPlugins(html: string) {
  return serializeHtml(html);
}

it("lets a custom plugin restore its canonical element content", () => {
  expect(
    serializeWithPlugins('<diagram data-nawc-node="diagram" data-nawc-source="a -> b"></diagram>'),
  ).toBe("<diagram>a -&gt; b</diagram>");
});
