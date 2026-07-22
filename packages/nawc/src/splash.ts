import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { NawcPlugin } from "@nawc/plugin";

const execFileAsync = promisify(execFile);

type ChildNode = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type Attr = { name: string; value: string };

function isElement(node: ChildNode): node is Element {
  return "tagName" in node && Array.isArray((node as Element).attrs);
}

export function notePathFor(target: string): string {
  return target.endsWith(".html") ? target : `${target}.html`;
}

export function normalizeWikiLinkTarget(target: string): string {
  return notePathFor(target.trim());
}

export function extractWikiLinks(html: string): readonly string[] {
  const root = parseFragment(html);
  const seen = new Set<string>();
  const visit = (node: ChildNode): void => {
    if (isElement(node)) {
      if (node.nodeName === "a") {
        const explicit = node.attrs
          .find((attr: Attr) => attr.name === "data-wiki-link")
          ?.value.trim();
        if (explicit) {
          seen.add(normalizeWikiLinkTarget(explicit));
        } else {
          const text = node.childNodes
            .map((child) => ("value" in child ? (child.value ?? "") : ""))
            .join("")
            .trim();
          const match = text.match(/^\[\[([^\]]+)\]\]$/);
          if (match) seen.add(normalizeWikiLinkTarget(match[1]));
        }
      }
    }
    const children = "childNodes" in node ? node.childNodes : [];
    for (const child of children) visit(child);
  };
  visit(root);
  return [...seen].sort();
}

export function extractFileReferences(
  html: string,
  plugins: readonly NawcPlugin[],
): readonly string[] {
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.references) continue;
    for (const ref of plugin.references({ html })) {
      const trimmed = ref.path.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return [...seen].sort();
}

const MERGE_CONFLICT_STATUSES = new Set(["UU", "AA", "DD", "AU", "UA", "UD", "DU"]);

/**
 * Returns project files modified in the working tree relative to the index,
 * including untracked files but excluding ignored and merge-conflict entries.
 */
export async function getModifiedProjectFiles(baseDir: string): Promise<Set<string>> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", baseDir, "status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const files = new Set<string>();
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    if (status === "!!") continue;
    if (MERGE_CONFLICT_STATUSES.has(status)) continue;
    const rest = line.slice(3);
    if (status.startsWith("R") || status.startsWith("C")) {
      const match = rest.match(/^(.+) -> (.+)$/);
      if (match) files.add(match[2].trim());
    } else {
      files.add(rest.trim());
    }
  }
  return files;
}

export type SplashLink = {
  readonly source: string;
  readonly targets: readonly string[];
};

export type SplashLayer = {
  readonly depth: number;
  readonly links: readonly SplashLink[];
};

export type SplashResult = {
  readonly zone: readonly string[];
  readonly layers: readonly SplashLayer[];
  readonly modifiedFiles: readonly string[];
};

export type SplashInputs = {
  readonly srcDir: string;
  readonly baseDir: string;
  readonly plugins: readonly NawcPlugin[];
  readonly depth: number;
};

async function readNoteFile(srcDir: string, note: string): Promise<string> {
  return readFile(path.join(srcDir, note), "utf8");
}

export async function computeSplash(inputs: SplashInputs): Promise<SplashResult> {
  const depth = Math.max(0, Math.floor(inputs.depth));
  const modifiedFiles = await getModifiedProjectFiles(inputs.baseDir);
  const notePaths = await readDirectory(inputs.srcDir);
  const zone: string[] = [];
  const cache = new Map<string, string>();
  for (const note of notePaths) {
    const html = await readNoteFile(inputs.srcDir, note);
    cache.set(note, html);
    const refs = extractFileReferences(html, inputs.plugins);
    if (refs.some((ref) => modifiedFiles.has(ref))) zone.push(note);
  }
  zone.sort();
  const layers: SplashLayer[] = [];
  let frontier = new Set(zone);
  const visited = new Set(zone);
  for (let current = 1; current <= depth; current += 1) {
    const next = new Set<string>();
    const links: SplashLink[] = [];
    for (const source of [...frontier].sort()) {
      const html = cache.get(source) ?? (await readNoteFile(inputs.srcDir, source));
      cache.set(source, html);
      const targets = extractWikiLinks(html);
      if (targets.length === 0) continue;
      links.push({ source, targets });
      for (const target of targets) {
        if (!visited.has(target)) {
          visited.add(target);
          next.add(target);
        }
      }
    }
    if (links.length === 0) break;
    layers.push({ depth: current, links });
    if (next.size === 0) break;
    frontier = next;
  }
  return {
    zone,
    layers,
    modifiedFiles: [...modifiedFiles].sort(),
  };
}

async function readDirectory(directory: string): Promise<readonly string[]> {
  const { readdir } = await import("node:fs/promises");
  const notes: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith(".html"))
        notes.push(path.relative(directory, file));
    }
  };
  await walk(directory);
  return notes.sort();
}
