import {
  definePlugin,
  type NawcFileReference,
  type NawcPlugin,
  type ResolvedSource,
  type SourceSelection,
} from "@nawc/plugin";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

type Element = DefaultTreeAdapterMap["element"];
type ChildNode = DefaultTreeAdapterMap["node"];
type Attr = { name: string; value: string };

const REFERENCE_TAGS = new Set(["code", "runnable", "interactive"]);

function isElement(node: ChildNode): node is Element {
  return "tagName" in node && Array.isArray((node as Element).attrs);
}

function fileAttributes(node: Element): readonly string[] {
  if (!REFERENCE_TAGS.has(node.nodeName)) return [];
  const value = node.attrs.find((attr: Attr) => attr.name === "file")?.value?.trim();
  return value ? [value] : [];
}

function collectReferences(root: ChildNode): readonly string[] {
  const seen = new Set<string>();
  const visit = (node: ChildNode): void => {
    if (isElement(node)) {
      for (const path of fileAttributes(node)) seen.add(path);
    }
    const children = "childNodes" in node ? node.childNodes : [];
    for (const child of children) visit(child);
  };
  visit(root);
  return [...seen].sort();
}

function coreReferences({ html }: { readonly html: string }): readonly NawcFileReference[] {
  const root = parseFragment(html);
  return collectReferences(root).map((path) => ({ path }));
}

function resolveFullSource(source: string, selection: SourceSelection): ResolvedSource {
  return {
    ...selection,
    code: source,
    startLine: 1,
    endLine: source.split("\n").length,
  };
}

export function core(): NawcPlugin {
  return definePlugin({
    name: "core",
    client: "@nawc/core/client",
    nodes: [
      { name: "interactive", tag: "interactive", description: "Sandboxed HTML prototype" },
      { name: "code", tag: "code", description: "Live or inline source code" },
      { name: "runnable", tag: "runnable", description: "Runnable source reference" },
    ],
    syntax: [
      {
        name: "markdown",
        aliases: ["md"],
        highlight: "markdown",
        extension: "md",
        resolve: resolveFullSource,
      },
      {
        name: "bash",
        aliases: ["sh", "shell", "zsh"],
        highlight: "bash",
        extension: "sh",
        resolve: resolveFullSource,
      },
    ],
    references: coreReferences,
  });
}
