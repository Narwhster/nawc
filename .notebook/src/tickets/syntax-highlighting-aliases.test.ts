import { expect, it } from "vitest";
import { syntaxFor } from "@nawc/config";
import { sourceLanguage } from "../../../plugins/core/src/source-highlighting.ts";

const diagram = { name: "diagram", aliases: ["diag"], resolve: () => undefined };

export function findSyntaxByAlias(value: string) {
  return syntaxFor(
    {
      plugins: [{ name: "diagram", syntax: [diagram] }],
      provider: { name: "test", async *prompt() {} },
      baseDir: ".",
    },
    value,
  );
}

it("shares configured aliases with the browser highlighter", () => {
  expect(findSyntaxByAlias("diag")).toBe(diagram);
  expect(sourceLanguage("diag")).toBe("diagram");
});
