import ts from "typescript";
import type { NawcSyntax, ResolvedSource, SourceSelection } from "@nawc/config";

const kinds: Record<string, readonly ts.SyntaxKind[]> = {
  function: [
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.ArrowFunction,
    ts.SyntaxKind.FunctionExpression,
  ],
  class: [ts.SyntaxKind.ClassDeclaration],
  type: [ts.SyntaxKind.TypeAliasDeclaration],
  interface: [ts.SyntaxKind.InterfaceDeclaration],
  variable: [ts.SyntaxKind.VariableDeclaration],
  enum: [ts.SyntaxKind.EnumDeclaration],
};

function nodeName(node: ts.Node): string | undefined {
  if ("name" in node) {
    const name = (node as ts.NamedDeclaration).name;
    if (name && ts.isIdentifier(name)) return name.text;
  }
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent)
  ) {
    return ts.isIdentifier(node.parent.name) ? node.parent.name.text : undefined;
  }
  return undefined;
}

export function resolveTypescript(
  source: string,
  selection: SourceSelection,
): ResolvedSource | undefined {
  if (!selection.name || !selection.type)
    return { ...selection, code: source, startLine: 1, endLine: source.split("\n").length };
  const file = ts.createSourceFile(selection.file, source, ts.ScriptTarget.Latest, true);
  const accepted = kinds[selection.type];
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (!found && accepted?.includes(node.kind) && nodeName(node) === selection.name)
      found = ts.isVariableDeclaration(node.parent) ? node.parent.parent : node;
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

export function typescript(): NawcSyntax {
  return {
    name: "typescript",
    aliases: ["ts", "tsx"],
    resolve: resolveTypescript,
    run: ({ file, cwd }) => ({
      command: [process.execPath, "--import", import.meta.resolve("tsx"), file],
      cwd,
    }),
  };
}
