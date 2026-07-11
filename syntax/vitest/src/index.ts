import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { NawcSyntax, ResolvedSource, SourceSelection } from "@nawc/config";

export function resolveVitest(
  source: string,
  selection: SourceSelection,
): ResolvedSource | undefined {
  if (!selection.name)
    return { ...selection, code: source, startLine: 1, endLine: source.split("\n").length };
  const file = ts.createSourceFile(selection.file, source, ts.ScriptTarget.Latest, true);
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const call = node.expression.text;
      const title = node.arguments[0];
      const wanted = selection.type ?? "it";
      const aliases = wanted === "it" ? ["it", "test"] : [wanted];
      if (
        aliases.includes(call) &&
        title &&
        ts.isStringLiteralLike(title) &&
        title.text === selection.name
      )
        found = node;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) return undefined;
  const start = found.getStart(file);
  const end = found.getEnd();
  return {
    ...selection,
    code: source.slice(start, end),
    startLine: file.getLineAndCharacterOfPosition(start).line + 1,
    endLine: file.getLineAndCharacterOfPosition(end).line + 1,
  };
}

export function vitest(): NawcSyntax {
  const cli = fileURLToPath(new URL("../vitest.mjs", import.meta.resolve("vitest")));
  return {
    name: "vitest",
    aliases: ["test"],
    resolve: resolveVitest,
    run: ({ file, name, cwd }) => ({
      command: [process.execPath, cli, "run", file, ...(name ? ["-t", name] : [])],
      cwd,
    }),
  };
}
