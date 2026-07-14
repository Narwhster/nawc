import type { NawcPlugin, NawcSyntax } from "@nawc/plugin";
import { z } from "zod";
export * from "./agent.ts";
export type {
  NawcSyntax,
  ResolvedSource,
  RunRequest,
  RunResult,
  SourceSelection,
} from "@nawc/plugin";
import type { NawcProvider } from "./agent.ts";

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

export type NawcConfig = {
  readonly plugins: readonly NawcPlugin[];
  readonly provider: NawcProvider;
  readonly baseDir: string;
  readonly editor?: NawcEditor;
  readonly theme?: NawcTheme;
  readonly port?: number;
};

export const configShape = z.strictObject({
  plugins: z.array(z.custom<NawcPlugin>()),
  provider: z.custom<NawcProvider>(),
  baseDir: z.string().min(1),
  editor: z.custom<NawcEditor>().optional(),
  theme: z.custom<NawcTheme>().optional(),
  port: z.number().int().min(1).max(65_535).optional(),
});

export function syntaxFor(config: NawcConfig, name?: string): NawcSyntax | undefined {
  if (!name) return undefined;
  return config.plugins
    .flatMap((plugin) => plugin.syntax ?? [])
    .find((item) => item.name === name || item.aliases.includes(name));
}
