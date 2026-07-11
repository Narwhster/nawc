import type { NawcPlugin } from "@nawc/plugin";
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
  readonly port?: number;
};

export const configShape = z.object({
  plugins: z.array(z.custom<NawcPlugin>()),
  provider: z.custom<NawcProvider>(),
  syntax: z.array(z.custom<NawcSyntax>()),
  baseDir: z.string().min(1),
  port: z.number().int().min(1).max(65_535).optional(),
});

export function defineConfig<const T extends NawcConfig>(config: T): T {
  configShape.parse(config);
  return config;
}

export function syntaxFor(config: NawcConfig, name?: string): NawcSyntax | undefined {
  if (!name) return undefined;
  return config.syntax.find((item) => item.name === name || item.aliases.includes(name));
}
