import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { syntaxFor, type NawcConfig, type SourceSelection } from "@nawc/config";

const execFileAsync = promisify(execFile);
const GENERATED_DIRECTORY_NAMES = new Set([
  ".git",
  ".skills",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const PROJECT_FILE_CACHE_TTL_MS = 2_000;
const projectFileCache = new Map<
  string,
  { readonly expiresAt: number; readonly files: readonly string[] }
>();

export async function safePath(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative)) throw new Error("Paths must be relative");
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`))
    throw new Error("Path escapes the configured directory");
  return target;
}

export async function safeExistingPath(root: string, relative: string): Promise<string> {
  const target = await realpath(await safePath(root, relative));
  const resolvedRoot = await realpath(root);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`))
    throw new Error("Path escapes the configured directory through a symbolic link");
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

async function projectFileCandidates(baseDir: string): Promise<readonly string[]> {
  const cacheKey = path.resolve(baseDir);
  const cached = projectFileCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.files;
  const { stdout } = await execFileAsync(
    "git",
    ["-C", baseDir, "ls-files", "-co", "--exclude-standard", "-z", "--", "."],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const files = stdout
    .split("\0")
    .filter(Boolean)
    .filter(
      (file) => !file.split(/[\\/]/).some((segment) => GENERATED_DIRECTORY_NAMES.has(segment)),
    )
    .sort();
  projectFileCache.set(cacheKey, { expiresAt: Date.now() + PROJECT_FILE_CACHE_TTL_MS, files });
  return files;
}

/** Lists a bounded set of tracked and unignored files underneath the configured base directory. */
export async function listProjectFiles(
  baseDir: string,
  options: { readonly query?: string; readonly limit?: number } = {},
): Promise<string[]> {
  const query = options.query?.trim().toLowerCase();
  const limit = options.limit === undefined ? undefined : Math.max(0, options.limit);
  const candidates = (await projectFileCandidates(baseDir))
    .filter((file) => !query || file.toLowerCase().includes(query))
    // Check a small surplus so an invalid/deleted symlink does not usually reduce the result page.
    .slice(0, limit === undefined ? undefined : limit * 2);
  const files = await Promise.all(
    candidates.map(async (file) => {
      try {
        await safeExistingPath(baseDir, file);
        return file;
      } catch {
        // Git can report deleted tracked files and symlinks that leave baseDir.
        return undefined;
      }
    }),
  );
  return files.filter((file): file is string => file !== undefined).slice(0, limit);
}

export type ProjectPath = {
  readonly path: string;
  readonly kind: "file" | "directory";
};

async function projectPathCandidates(baseDir: string): Promise<readonly string[]> {
  const files = await projectFileCandidates(baseDir);
  const paths = new Set(files);
  for (const file of files) {
    const segments = file.split("/");
    for (let index = 1; index < segments.length; index++) {
      paths.add(segments.slice(0, index).join("/"));
    }
  }
  return [...paths].sort();
}

/** Lists searchable project files and their containing directories. */
export async function listProjectPaths(
  baseDir: string,
  options: { readonly query?: string; readonly limit?: number } = {},
): Promise<readonly ProjectPath[]> {
  const query = options.query?.trim().toLowerCase();
  const limit = options.limit === undefined ? undefined : Math.max(0, options.limit);
  const candidates = (await projectPathCandidates(baseDir))
    .filter((candidate) => !query || candidate.toLowerCase().includes(query))
    .slice(0, limit === undefined ? undefined : limit * 2);
  const paths = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const file = await safeExistingPath(baseDir, candidate);
        return {
          path: candidate,
          kind: (await stat(file)).isDirectory() ? "directory" : "file",
        } as const;
      } catch {
        return undefined;
      }
    }),
  );
  return paths.filter((entry): entry is ProjectPath => entry !== undefined).slice(0, limit);
}

/** Validates one submitted reference without walking or resolving every project file. */
export async function isProjectFile(baseDir: string, file: string): Promise<boolean> {
  if (!(await projectFileCandidates(baseDir)).includes(file)) return false;
  try {
    await safeExistingPath(baseDir, file);
    return true;
  } catch {
    return false;
  }
}

/** Validates one submitted project path, including directories. */
export async function isProjectPath(baseDir: string, file: string): Promise<boolean> {
  if (!(await projectPathCandidates(baseDir)).includes(file)) return false;
  try {
    await safeExistingPath(baseDir, file);
    return true;
  } catch {
    return false;
  }
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
  const syntax = syntaxFor(config, selection.syntax);
  if (!syntax) throw new Error(`Unknown syntax: ${selection.syntax}`);
  const resolved = syntax.resolve(source, selection);
  if (!resolved)
    throw new Error(
      `Could not find ${selection.type ?? "symbol"} ${selection.name ?? ""}${selection.params === undefined ? "" : `(${selection.params})`} in ${selection.file}`,
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
