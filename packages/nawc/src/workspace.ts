import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { NawcConfig, SourceSelection } from "@nawc/config";

export async function safePath(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative)) throw new Error("Paths must be relative");
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`))
    throw new Error("Path escapes the configured directory");
  return target;
}

export async function listNotes(srcDir: string): Promise<string[]> {
  const notes: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith(".html"))
        notes.push(path.relative(srcDir, file));
    }
  };
  await mkdir(srcDir, { recursive: true });
  await walk(srcDir);
  return notes.sort();
}

export type WorkspaceEntry = {
  readonly path: string;
  readonly type: "file" | "folder";
};

export async function listEntries(srcDir: string): Promise<WorkspaceEntry[]> {
  const entries: WorkspaceEntry[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push({ path: path.relative(srcDir, file), type: "folder" });
        await walk(file);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        entries.push({ path: path.relative(srcDir, file), type: "file" });
      }
    }
  };
  await mkdir(srcDir, { recursive: true });
  await walk(srcDir);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readNote(srcDir: string, note: string): Promise<string> {
  return readFile(await safePath(srcDir, note), "utf8");
}

export async function writeNote(srcDir: string, note: string, content: string): Promise<void> {
  if (!note.endsWith(".html")) throw new Error("Notes must use the .html extension");
  const file = await safePath(srcDir, note);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

export async function deleteNote(srcDir: string, note: string): Promise<void> {
  await rm(await safePath(srcDir, note));
}

export async function createFolder(srcDir: string, folder: string): Promise<void> {
  const target = await safePath(srcDir, folder);
  await mkdir(target, { recursive: false });
}

export async function deleteEntry(srcDir: string, entry: string): Promise<void> {
  await rm(await safePath(srcDir, entry), { recursive: true });
}

export async function renameEntry(srcDir: string, from: string, to: string): Promise<void> {
  const source = await safePath(srcDir, from);
  const target = await safePath(srcDir, to);
  try {
    await access(target);
    throw new Error(`An entry already exists at ${to}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await mkdir(path.dirname(target), { recursive: true });
      await rename(source, target);
      return;
    }
    throw error;
  }
}

export async function moveEntry(
  srcDir: string,
  from: string,
  to: string,
  replace = false,
): Promise<void> {
  const source = await safePath(srcDir, from);
  const target = await safePath(srcDir, to);
  if (source === target) return;
  if (target.startsWith(`${source}${path.sep}`))
    throw new Error("A folder cannot be moved inside itself");
  try {
    await access(target);
    if (!replace) throw new Error(`An entry already exists at ${to}`);
    await rm(target, { recursive: true });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await rename(source, target);
}

export async function renameNote(srcDir: string, from: string, to: string): Promise<void> {
  if (!to.endsWith(".html")) throw new Error("Notes must use the .html extension");
  const target = await safePath(srcDir, to);
  await mkdir(path.dirname(target), { recursive: true });
  await rename(await safePath(srcDir, from), target);
}

export async function resolveSource(
  config: NawcConfig,
  baseDir: string,
  selection: SourceSelection,
) {
  const file = await safePath(baseDir, selection.file);
  const source = await readFile(file, "utf8");
  if (!selection.syntax)
    return { ...selection, code: source, startLine: 1, endLine: source.split("\n").length };
  const syntax = config.syntax.find(
    (item) => item.name === selection.syntax || item.aliases.includes(selection.syntax!),
  );
  if (!syntax) throw new Error(`Unknown syntax: ${selection.syntax}`);
  const resolved = syntax.resolve(source, selection);
  if (!resolved)
    throw new Error(
      `Could not find ${selection.type ?? "symbol"} ${selection.name ?? ""} in ${selection.file}`,
    );
  return resolved;
}

export async function assertGitRepository(baseDir: string): Promise<void> {
  let current = await realpath(baseDir);
  while (true) {
    try {
      await realpath(path.join(current, ".git"));
      return;
    } catch {
      const parent = path.dirname(current);
      if (parent === current)
        throw new Error(`NAWC baseDir must be inside a Git repository: ${baseDir}`);
      current = parent;
    }
  }
}
