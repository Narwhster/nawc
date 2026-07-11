import type { Editor } from "@tiptap/core";

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
    if (kind === "interactive")
      replacement.innerHTML = element.dataset.nawcSource ?? element.getAttribute("source") ?? "";
    element.replaceWith(replacement);
  }
  return document.body.innerHTML;
}
