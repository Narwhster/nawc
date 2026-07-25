import { expect, it } from "vitest";
import { sourceLanguage } from "../../../../plugins/core/src/source-highlighting.ts";

export function highlightWithSyntax(name: string, code: string) {
  const language = sourceLanguage(name);
  return language ? `${language}:${code}` : code;
}

it("uses a configured syntax adapter for highlighting", () => {
  expect(highlightWithSyntax("diagram", "a -> b")).toBe("diagram:a -> b");
});
