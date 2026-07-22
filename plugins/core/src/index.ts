import { definePlugin, type NawcFileReference } from "@nawc/plugin";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

type Element = DefaultTreeAdapterMap["element"];
type ChildNode = DefaultTreeAdapterMap["node"];
type Attr = { name: string; value: string };

const REFERENCE_TAGS = new Set(["ref", "runnable", "interactive"]);

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

export function core() {
  return definePlugin({
    name: "core",
    client: "@nawc/core/client",
    nodes: [
      { name: "interactive", tag: "interactive", description: "Sandboxed HTML prototype" },
      { name: "ref", tag: "ref", description: "Live source reference" },
      { name: "runnable", tag: "runnable", description: "Runnable source reference" },
    ],
    references: coreReferences,
  });
}
