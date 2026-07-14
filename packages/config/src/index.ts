import type { NawcPlugin } from "@nawc/plugin";
import { z } from "zod";
export * from "./agent.ts";
import type { NawcProvider } from "./agent.ts";

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

export type EditorLocation = {
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
};

export type NawcEditorIcon = {
  readonly name: string;
  readonly viewBox: string;
  readonly paths: readonly string[];
};

export type NawcEditor = {
  readonly name: string;
  readonly label: string;
  readonly icon?: NawcEditorIcon;
  open(location: EditorLocation): EditorTarget;
};

export type EditorTarget =
  | { readonly type: "command"; readonly command: readonly string[] }
  | { readonly type: "url"; readonly url: string };

export type NawcTheme = {
  readonly name: string;
  readonly appearance: "light" | "dark";
  readonly variables: Readonly<Record<`--${string}`, string>>;
};

export type NawcSyntax = {
  readonly name: string;
  readonly aliases: readonly string[];
  resolve(source: string, selection: SourceSelection): ResolvedSource | undefined;
  run?(request: RunRequest): RunResult;
};

export type NawcConfig = {
  readonly plugins: readonly NawcPlugin[];
  readonly provider: NawcProvider;
  readonly syntax: readonly NawcSyntax[];
  readonly baseDir: string;
  readonly editor?: NawcEditor;
  readonly theme?: NawcTheme;
  readonly port?: number;
};

export const configShape = z.object({
  plugins: z.array(z.custom<NawcPlugin>()),
  provider: z.custom<NawcProvider>(),
  syntax: z.array(z.custom<NawcSyntax>()),
  baseDir: z.string().min(1),
  editor: z.custom<NawcEditor>().optional(),
  theme: z.custom<NawcTheme>().optional(),
  port: z.number().int().min(1).max(65_535).optional(),
});

export function syntaxFor(config: NawcConfig, name?: string): NawcSyntax | undefined {
  if (!name) return undefined;
  return config.syntax.find((item) => item.name === name || item.aliases.includes(name));
}
