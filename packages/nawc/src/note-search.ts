import { readFile } from "node:fs/promises";
import path from "node:path";
import MiniSearch, { type SearchResult as MiniSearchResult } from "minisearch";
import { parseFragment } from "parse5";
import { listNotes } from "./workspace.ts";

type HtmlNode = {
  readonly nodeName?: string;
  readonly value?: string;
  readonly childNodes?: readonly HtmlNode[];
};

type NoteDocument = {
  readonly path: string;
  readonly title: string;
  readonly text: string;
};

export type NoteSearchResult = {
  readonly path: string;
  readonly title: string;
  readonly snippet: string;
  readonly terms: readonly string[];
};

function noteTitle(notePath: string): string {
  return path.basename(notePath, ".html");
}

export function htmlText(html: string): string {
  const root = parseFragment(html) as HtmlNode;
  const parts: string[] = [];
  const visit = (node: HtmlNode, ignored = false): void => {
    const skip = ignored || node.nodeName === "script" || node.nodeName === "style";
    if (!skip && node.nodeName === "#text" && node.value) parts.push(node.value);
    for (const child of node.childNodes ?? []) visit(child, skip);
  };
  visit(root);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function snippet(text: string, terms: readonly string[], maximumLength = 150): string {
  if (text.length <= maximumLength) return text;
  const lower = text.toLowerCase();
  const positions = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((position) => position >= 0);
  const match = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, Math.min(match - 45, text.length - maximumLength));
  const beginning = start > 0 ? "…" : "";
  const ending = start + maximumLength < text.length ? "…" : "";
  return `${beginning}${text.slice(start, start + maximumLength).trim()}${ending}`;
}

function createIndex(): MiniSearch<NoteDocument> {
  return new MiniSearch<NoteDocument>({
    fields: ["title", "path", "text"],
    idField: "path",
    storeFields: ["path", "title", "text"],
    searchOptions: {
      boost: { title: 6, path: 4, text: 1 },
      combineWith: "AND",
      fuzzy: 0.2,
      prefix: true,
    },
  });
}

export class NoteSearchIndex {
  readonly #srcDir: string;
  #dirty = true;
  #revision = 0;
  #index = createIndex();
  #rebuild?: Promise<void>;

  constructor(srcDir: string) {
    this.#srcDir = srcDir;
  }

  invalidate(): void {
    this.#dirty = true;
    this.#revision += 1;
  }

  async #ensureFresh(): Promise<void> {
    while (this.#dirty) {
      if (!this.#rebuild) {
        const revision = this.#revision;
        this.#rebuild = (async () => {
          const notes = await listNotes(this.#srcDir);
          const documents = await Promise.all(
            notes.map(async (notePath): Promise<NoteDocument> => {
              const html = await readFile(path.join(this.#srcDir, notePath), "utf8");
              return { path: notePath, title: noteTitle(notePath), text: htmlText(html) };
            }),
          );
          const next = createIndex();
          next.addAll(documents);
          this.#index = next;
          this.#dirty = revision !== this.#revision;
        })().finally(() => {
          this.#rebuild = undefined;
        });
      }
      await this.#rebuild;
    }
  }

  async search(query: string, limit = 30): Promise<NoteSearchResult[]> {
    await this.#ensureFresh();
    const normalized = query.trim();
    if (!normalized) return [];
    return this.#index
      .search(normalized)
      .slice(0, limit)
      .map((result: MiniSearchResult) => {
        const note = result as MiniSearchResult & NoteDocument;
        return {
          path: note.path,
          title: note.title,
          snippet: snippet(note.text, result.terms),
          terms: result.terms,
        };
      });
  }
}
