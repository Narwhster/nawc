import { Node } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { NodeType } from "@tiptap/pm/model";
import {
  mountWikiLinkMenu,
  type WikiLinkMenuHandle,
  type WikiLinkOption,
} from "@nawcui/components/wiki-link-menu";

export function notePath(target: string): string {
  return target.endsWith(".html") ? target : `${target}.html`;
}

export function wikiLinkQuery(
  state: EditorState,
): { from: number; to: number; query: string } | undefined {
  const { $from } = state.selection;
  if (!state.selection.empty) return undefined;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const match = before.match(/\[\[([^[\]]*)$/);
  if (!match) return undefined;
  return { from: $from.pos - match[0].length, to: $from.pos, query: match[1] ?? "" };
}

export function wikiLinkMenuPosition(
  anchor: Pick<DOMRect, "top" | "bottom" | "left">,
  menu: { readonly width: number; readonly height: number },
  viewport: {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
  },
) {
  const below = anchor.bottom + 4;
  return {
    left: Math.max(
      viewport.left + 8,
      Math.min(anchor.left, viewport.left + viewport.width - menu.width - 8),
    ),
    top:
      below + menu.height > viewport.top + viewport.height
        ? Math.max(viewport.top + 8, anchor.top - menu.height - 4)
        : below,
  };
}

function fuzzyNotes(notes: readonly string[], query: string): string[] {
  const needle = query.toLowerCase();
  const score = (note: string) => {
    const candidate = note.toLowerCase().replace(/\.html$/, "");
    const direct = candidate.indexOf(needle);
    if (direct >= 0) return direct;
    let at = 0;
    for (const character of needle) {
      at = candidate.indexOf(character, at);
      if (at < 0) return Number.POSITIVE_INFINITY;
      at += 1;
    }
    return candidate.length;
  };
  return notes
    .map((note) => ({ note, score: score(note) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score || left.note.localeCompare(right.note))
    .slice(0, 8)
    .map((item) => item.note);
}

function wikiLinkAutocomplete(type: NodeType) {
  let menu: HTMLDivElement | undefined;
  let menuHandle: WikiLinkMenuHandle | undefined;
  let options: readonly WikiLinkOption[] = [];
  let selected = 0;
  let request = 0;
  const close = () => {
    request += 1;
    menuHandle?.destroy();
    menuHandle = undefined;
    menu?.remove();
    menu = undefined;
    options = [];
  };
  const insert = (view: EditorView, target: string) => {
    const query = wikiLinkQuery(view.state);
    if (!query) return;
    const normalized = target.replace(/\.html$/, "");
    view.dispatch(
      view.state.tr.replaceWith(query.from, query.to, type.create({ target: normalized })),
    );
    close();
  };
  const position = (view: EditorView) => {
    if (!menu) return;
    const coordinates = view.coordsAtPos(view.state.selection.from);
    const viewport = window.visualViewport;
    const location = wikiLinkMenuPosition(
      coordinates,
      { width: menu.offsetWidth, height: menu.getBoundingClientRect().height },
      {
        top: viewport?.offsetTop ?? 0,
        left: viewport?.offsetLeft ?? 0,
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
      },
    );
    menu.style.left = `${location.left}px`;
    menu.style.top = `${location.top}px`;
  };
  const select = (view: EditorView, option: WikiLinkOption) => {
    if (!option.create) return insert(view, option.target);
    const path = notePath(option.target);
    void fetch("/api/note", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content: "<h1></h1><p></p>" }),
    })
      .then((response) => {
        if (!response.ok) return;
        insert(view, option.target);
        window.dispatchEvent(
          new CustomEvent("nawc:open-note", { detail: { path, newPanel: true } }),
        );
      })
      .catch(() => undefined);
  };
  const render = (view: EditorView, query: string, notes: readonly string[]) => {
    close();
    const matches = fuzzyNotes(notes, query);
    menu = document.createElement("div");
    menu.className = "nawc-wiki-link-menu";
    options = matches.map((note) => ({
      label: note.replace(/\.html$/, ""),
      target: note,
      create: false,
    }));
    if (query.trim() && !notes.some((note) => notePath(query) === note))
      options = [...options, { label: query.trim(), target: query.trim(), create: true }];
    if (!options.length) return close();
    document.body.append(menu);
    menuHandle = mountWikiLinkMenu(menu);
    menuHandle.render({ options, selected, onSelect: (option) => select(view, option) });
    requestAnimationFrame(() => position(view));
  };
  return new Plugin({
    key: new PluginKey("wikiLinkAutocomplete"),
    props: {
      handleKeyDown(view, event) {
        if (!menu) return false;
        if (event.key === "Escape") {
          close();
          return true;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          selected =
            (selected + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
          menuHandle?.render({ options, selected, onSelect: (option) => select(view, option) });
          return true;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const option = options[selected];
          if (option) select(view, option);
          return true;
        }
        return false;
      },
    },
    view(view) {
      let editorView = view;
      const reposition = () => {
        if (menu) position(editorView);
      };
      window.visualViewport?.addEventListener("resize", reposition);
      window.visualViewport?.addEventListener("scroll", reposition);
      return {
        update(next) {
          editorView = next;
          const query = wikiLinkQuery(next.state);
          if (!query) return close();
          selected = 0;
          const current = ++request;
          void fetch("/api/notes")
            .then(async (response) => {
              if (current !== request || !response.ok) return;
              render(next, query.query, (await response.json()) as string[]);
            })
            .catch(() => undefined);
        },
        destroy() {
          window.visualViewport?.removeEventListener("resize", reposition);
          window.visualViewport?.removeEventListener("scroll", reposition);
          close();
        },
      };
    },
  });
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
  addProseMirrorPlugins() {
    return [wikiLinkAutocomplete(this.type)];
  },
});
