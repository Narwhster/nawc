import type { NawcPlugin } from "@nawc/plugin";
import { pathToFileURL } from "node:url";
import { z } from "zod";

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
export type RunResult = { readonly command: readonly string[]; readonly cwd: string };

export type EditorLocation = {
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
};

export type NawcEditor = {
  readonly name: string;
  readonly label: string;
  readonly icon?: string;
  open(location: EditorLocation): EditorTarget;
};

export type EditorTarget =
  | { readonly type: "command"; readonly command: readonly string[] }
  | { readonly type: "url"; readonly url: string };

export function vscode(): NawcEditor {
  return {
    name: "vscode",
    label: "VS Code",
    icon: "vscode",
    open: ({ file, line, column }) => ({
      type: "url",
      url: `vscode://file${pathToFileURL(file).pathname}${line ? `:${line}:${column ?? 1}` : ""}`,
    }),
  };
}

export type NawcSyntax = {
  readonly name: string;
  readonly aliases: readonly string[];
  resolve(source: string, selection: SourceSelection): ResolvedSource | undefined;
  run?(request: RunRequest): RunResult;
};

export type ProviderEvent =
  | { readonly type: "thread.started"; readonly threadId: string }
  | { readonly type: "message"; readonly text: string }
  | { readonly type: "command"; readonly command: string; readonly status: string }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done" };

export type NawcProvider = {
  readonly name: string;
  prompt(input: {
    readonly prompt: string;
    readonly cwd: string;
    readonly skillsDir: string;
  }): AsyncIterable<ProviderEvent>;
};

export type NawcConfig = {
  readonly plugins: readonly NawcPlugin[];
  readonly provider: NawcProvider;
  readonly syntax: readonly NawcSyntax[];
  readonly baseDir: string;
  readonly editor?: NawcEditor;
  readonly port?: number;
};

export const configShape = z.object({
  plugins: z.array(z.custom<NawcPlugin>()),
  provider: z.custom<NawcProvider>(),
  syntax: z.array(z.custom<NawcSyntax>()),
  baseDir: z.string().min(1),
  editor: z.custom<NawcEditor>().optional(),
  port: z.number().int().min(1).max(65_535).optional(),
});

export function defineConfig<const T extends NawcConfig>(
  config: T,
): T & { readonly editor: NawcEditor } {
  configShape.parse(config);
  return { ...config, editor: config.editor ?? vscode() };
}

export function syntaxFor(config: NawcConfig, name?: string): NawcSyntax | undefined {
  if (!name) return undefined;
  return config.syntax.find((item) => item.name === name || item.aliases.includes(name));
}
