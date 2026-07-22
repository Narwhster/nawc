import type { AnyExtension } from "@tiptap/core";
import type { PluginOption } from "vite";

export type NawcSkill = {
  readonly name: string;
  readonly content: string;
};

/**
 * A project file referenced from a note. Paths are relative to the configured
 * `baseDir` and may include any file extension the notebook uses.
 */
export type NawcFileReference = {
  readonly path: string;
};

export type SourceSelection = {
  readonly file: string;
  readonly source?: string;
  readonly syntax?: string;
  readonly name?: string;
  readonly type?: string;
  readonly params?: string;
};

export type ResolvedSource = SourceSelection & {
  readonly code: string;
  readonly startLine: number;
  readonly endLine: number;
};

export type RunRequest = SourceSelection & { readonly cwd: string };

export type RunResult = {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly script?: string;
};

export type NawcSyntax = {
  readonly name: string;
  readonly aliases: readonly string[];
  /** Highlight.js language used for this syntax and all of its aliases in the browser. */
  readonly highlight?: string;
  /** File extension used when materializing an inline runnable, without a leading dot. */
  readonly extension?: string;
  resolve(source: string, selection: SourceSelection): ResolvedSource | undefined;
  run?(request: RunRequest): RunResult;
};

export type NawcNode = {
  readonly name: string;
  readonly tag: string;
  readonly description: string;
};

export type NawcPlugin = {
  readonly name: string;
  /** Browser module imported by the notebook's generated Vite entry, when needed. */
  readonly client?: string;
  readonly nodes?: readonly NawcNode[];
  readonly syntax?: readonly NawcSyntax[];
  readonly skills?: readonly NawcSkill[];
  /**
   * Extract project files referenced from a note's HTML. Used by
   * `nawc splash` to identify which notes touch files modified in the
   * worktree. Paths are relative to the configured `baseDir`.
   */
  readonly references?: (input: { readonly html: string }) => readonly NawcFileReference[];
  /** Vite integration created after NAWC has resolved the configured project directory. */
  readonly vite?: (context: { readonly baseDir: string }) => PluginOption;
};

export type NawcClientPlugin = {
  readonly name: string;
  readonly extensions: readonly AnyExtension[];
};

export function definePlugin<const T extends NawcPlugin>(plugin: T): T {
  return plugin;
}
