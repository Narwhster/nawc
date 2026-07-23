import type { Editor } from "@tiptap/core";

export function normalizeSelfClosingNodes(html: string, tags: readonly string[]): string {
  if (!tags.length) return html;
  const names = tags.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`<(${names})(?=[\\s/>])([^<>]*?)/>`, "gi");
  return html.replace(
    pattern,
    (_match, tag: string, attributes: string) => `<${tag}${attributes}></${tag}>`,
  );
}

/**
 * Marks top-level `<code>` elements as nawc code blocks so the editor parses
 * them as block nodes instead of the inline code mark. Nested `<code>`
 * elements (inside paragraphs, `<pre>`, lists, …) keep their mark semantics.
 */
export function normalizeCodeBlocks(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const blocks = document.body.querySelectorAll(":scope > code:not([data-nawc-node])");
  for (const element of blocks) element.setAttribute("data-nawc-node", "code");
  return blocks.length ? document.body.innerHTML : html;
}

export function normalizeNoteContent(html: string, tags: readonly string[]): string {
  return normalizeCodeBlocks(normalizeSelfClosingNodes(html, tags));
}

export function serializeNote(editor: Editor): string {
  return serializeHtml(editor.getHTML());
}

export function serializeHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const element of document.querySelectorAll<HTMLElement>("[data-nawc-node]")) {
    const kind = element.dataset.nawcNode;
    if (!kind) continue;
    const replacement = document.createElement(kind);
    for (const attribute of element.attributes) {
      if (!attribute.name.startsWith("data-nawc-") && attribute.name !== "source")
        replacement.setAttribute(attribute.name, attribute.value);
    }
    const source = element.dataset.nawcSource ?? element.getAttribute("source") ?? "";
    if (kind === "interactive") replacement.innerHTML = source;
    if ((kind === "runnable" || kind === "code") && !element.getAttribute("file"))
      replacement.textContent = source;
    element.replaceWith(replacement);
  }
  return document.body.innerHTML;
}
