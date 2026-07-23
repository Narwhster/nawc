import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Node as SyntaxNode } from "web-tree-sitter";
import {
  definePlugin,
  type NawcPlugin,
  type ResolvedSource,
  type RunResult,
  type SourceSelection,
} from "@nawc/plugin";

await Parser.init();
const wasmPath = fileURLToPath(import.meta.resolve("tree-sitter-rust/tree-sitter-rust.wasm"));
const rustLanguage = await Language.load(wasmPath);
const parser = new Parser();
parser.setLanguage(rustLanguage);

export const rustSkill = `---
name: rust
description: Use when writing code or runnable blocks for Rust source.
---

# Rust syntax

Use \`syntax="rust"\` or \`syntax="rs"\` for Rust source.

## Code blocks

Use \`name\` and \`type\` to select a declaration. Supported declaration types are:

- \`fn\` for functions and methods
- \`struct\`
- \`enum\`
- \`trait\`
- \`impl\` (the name is the implemented type, so \`impl Display for Foo\` selects as \`Foo\`)
- \`mod\`
- \`const\`
- \`static\`
- \`type\`
- \`macro\` for \`macro_rules!\` definitions

Without both \`name\` and \`type\`, the whole file is referenced.

\`\`\`html
<code file="src/calculator.rs" syntax="rust" name="add" type="fn"></code>
\`\`\`

## Runnable blocks

Runnable blocks for the \`rust\` syntax require the \`cargo-eval\` subcommand. Install it once on the host machine:

\`\`\`sh
cargo install cargo-eval
\`\`\`

- Without a selector, the file is compiled and run with \`cargo eval <file>\`.
- With \`type="fn"\` and \`name\`, the file is compiled and run with \`cargo eval --expr "<source>\\n<name>()"\`, invoking the named free function with no arguments.

The cargo binary is configurable with the \`cargo\` plugin option.
`;

export const cargoTestSkill = `---
name: cargo-test
description: Use when writing code or runnable blocks for Rust tests.
---

# Cargo test syntax

Use \`syntax="cargo-test"\` or \`syntax="test"\` for Rust test source.

## Code blocks

Without \`name\`, the whole test file is referenced. With \`name\`, select a test function annotated with an attribute ending in \`test\`, such as \`#[test]\` or \`#[tokio::test]\`. The name is the Rust function name; no declaration type is required.

## Runnable blocks

Runnable blocks run \`cargo test\` in the notebook directory. When \`name\` is present, it is passed as the cargo test name filter. Without a name, all tests in the project run. The cargo binary is configurable with the \`cargo\` plugin option.
`;

const declarationKinds: Record<string, readonly string[]> = {
  fn: ["function_item", "function_signature_item"],
  struct: ["struct_item"],
  enum: ["enum_item"],
  trait: ["trait_item"],
  impl: ["impl_item"],
  mod: ["mod_item"],
  const: ["const_item"],
  static: ["static_item"],
  type: ["type_item"],
  macro: ["macro_definition"],
};

function declarationName(node: SyntaxNode): string | undefined {
  if (node.type === "impl_item") {
    return node.childForFieldName("type")?.text ?? undefined;
  }
  return node.childForFieldName("name")?.text ?? undefined;
}

function findNode(
  node: SyntaxNode,
  predicate: (node: SyntaxNode) => boolean,
): SyntaxNode | undefined {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return undefined;
}

function isTestAttribute(node: SyntaxNode, source: string): boolean {
  const text = source.slice(node.startIndex, node.endIndex);
  const inner = text.replace(/^#\s*\[\s*/, "").replace(/\s*\]$/, "");
  const attributePath = inner.split("(")[0]!.trim();
  return attributePath.split("::").pop() === "test";
}

function wholeFile(source: string, selection: SourceSelection): ResolvedSource {
  return { ...selection, code: source, startLine: 1, endLine: source.split("\n").length };
}

function slice(source: string, selection: SourceSelection, node: SyntaxNode): ResolvedSource {
  return {
    ...selection,
    code: source.slice(node.startIndex, node.endIndex),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
}

export function resolveRust(
  source: string,
  selection: SourceSelection,
): ResolvedSource | undefined {
  if (!selection.name || !selection.type) return wholeFile(source, selection);
  const accepted = declarationKinds[selection.type];
  if (!accepted) return undefined;

  const tree = parser.parse(source);
  try {
    const found = findNode(
      tree!.rootNode,
      (node) => accepted.includes(node.type) && declarationName(node) === selection.name,
    );
    return found && slice(source, selection, found);
  } finally {
    tree?.delete();
  }
}

export function resolveCargoTest(
  source: string,
  selection: SourceSelection,
): ResolvedSource | undefined {
  if (!selection.name) return wholeFile(source, selection);

  const tree = parser.parse(source);
  try {
    const found = findNode(tree!.rootNode, (node) => {
      if (node.type !== "function_item" || declarationName(node) !== selection.name) return false;
      let sibling = node.previousNamedSibling;
      while (sibling?.type === "attribute_item") {
        if (isTestAttribute(sibling, source)) return true;
        sibling = sibling.previousNamedSibling;
      }
      return false;
    });
    if (!found) return undefined;

    // Include the contiguous attributes above the test, like JUnit includes @Test.
    let start = found;
    while (start.previousNamedSibling?.type === "attribute_item")
      start = start.previousNamedSibling;
    return {
      ...selection,
      code: source.slice(start.startIndex, found.endIndex),
      startLine: start.startPosition.row + 1,
      endLine: found.endPosition.row + 1,
    };
  } finally {
    tree?.delete();
  }
}

export type RustOptions = {
  readonly cargo?: string;
};

export function rust(options?: RustOptions): NawcPlugin {
  return definePlugin({
    name: "rust",
    syntax: [
      {
        name: "rust",
        aliases: ["rs"],
        highlight: "rust",
        extension: "rs",
        resolve: resolveRust,
        run: ({ file, name, type, cwd }): RunResult => {
          const cargo = options?.cargo ?? "cargo";
          if (!name || !type) {
            return { command: [cargo, "eval", file], cwd };
          }
          if (type === "fn") {
            const source = readFileSync(path.resolve(cwd, file), "utf8");
            return { command: [cargo, "eval", "--expr", `${source}\n${name}()`], cwd };
          }
          throw new Error(`Unsupported selector type: ${type}`);
        },
      },
      {
        name: "cargo-test",
        aliases: ["test"],
        highlight: "rust",
        resolve: resolveCargoTest,
        run: ({ name, cwd }): RunResult => ({
          command: [options?.cargo ?? "cargo", "test", ...(name ? [name] : [])],
          cwd,
        }),
      },
    ],
    skills: [
      { name: "rust", content: rustSkill },
      { name: "cargo-test", content: cargoTestSkill },
    ],
  });
}
