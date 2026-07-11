import { Node, nodeInputRule } from "@tiptap/core";

export function notePath(target: string): string {
  return target.endsWith(".html") ? target : `${target}.html`;
}

export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      target: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-wiki-link"),
      },
    };
  },
  parseHTML() {
    return [
      { tag: "a[data-wiki-link]", priority: 1000 },
      {
        tag: "a",
        priority: 1000,
        getAttrs: (element) => {
          if (element.hasAttribute("data-wiki-link")) return false;
          const match = element.textContent?.match(/^\[\[([^\]]+)\]\]$/);
          return match ? { target: match[1] } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    const target = String(node.attrs.target);
    return [
      "a",
      { "data-wiki-link": target, href: `#${encodeURIComponent(target)}` },
      `[[${target}]]`,
    ];
  },
  addInputRules() {
    return [
      nodeInputRule({
        find: /\[\[([^\]]+)\]\]$/,
        type: this.type,
        getAttributes: (match) => ({ target: match[1] }),
      }),
    ];
  },
});
