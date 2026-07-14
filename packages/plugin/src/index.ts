import type { AnyExtension } from "@tiptap/core";

export type NawcSkill = {
  readonly name: string;
  readonly content: string;
};

export type SourceSelection = {
  readonly file: string;
  readonly syntax?: string;
  readonly name?: string;
  readonly type?: string;
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
};

export type NawcClientPlugin = {
  readonly name: string;
  readonly extensions: readonly AnyExtension[];
};

export function definePlugin<const T extends NawcPlugin>(plugin: T): T {
  return plugin;
}
