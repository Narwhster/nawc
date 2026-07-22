import ts from "typescript";
import {
  definePlugin,
  type NawcPlugin,
  type ResolvedSource,
  type SourceSelection,
} from "@nawc/plugin";

export const typescriptSkill = `---
name: typescript
description: Use when writing ref or runnable blocks for TypeScript source.
---

# TypeScript syntax

Use \`syntax="typescript"\`, \`syntax="ts"\`, or \`syntax="tsx"\` for TypeScript source.

## Ref blocks

Use \`name\` and \`type\` to select a declaration. Supported declaration types are:

- \`function\` for functions, methods, arrow functions, and function expressions
- \`class\`
- \`type\`
- \`interface\`
- \`variable\`
- \`enum\`

Without both \`name\` and \`type\`, the whole file is referenced.

## Runnable blocks

Runnable TypeScript blocks execute the selected file with \`tsx\`. The runner ignores declaration selectors, so use a file whose top-level execution is the desired example.
`;

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

export function typescript(): NawcPlugin {
  return definePlugin({
    name: "typescript",
    syntax: [
      {
        name: "typescript",
        aliases: ["ts", "tsx"],
        highlight: "typescript",
        extension: "ts",
        resolve: resolveTypescript,
        run: ({ file, cwd }) => ({
          command: [process.execPath, "--import", import.meta.resolve("tsx"), file],
          cwd,
        }),
      },
    ],
    skills: [{ name: "typescript", content: typescriptSkill }],
  });
}
