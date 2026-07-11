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

export type NawcTheme = {
  readonly name: string;
  readonly appearance: "light" | "dark";
  readonly variables: Readonly<Record<`--${string}`, string>>;
};

const sharedThemeVariables = {
  "--radius": "0",
  "--font-sans": '"JetBrains Mono Variable", monospace',
  "--font-mono": '"JetBrains Mono Variable", monospace',
} as const;

export function nawcLight(): NawcTheme {
  return {
    name: "nawc-light",
    appearance: "light",
    variables: {
      ...sharedThemeVariables,
      "--background": "oklch(1 0 0)",
      "--foreground": "oklch(0.148 0.004 228.8)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.148 0.004 228.8)",
      "--popover": "oklch(1 0 0)",
      "--popover-foreground": "oklch(0.148 0.004 228.8)",
      "--primary": "oklch(0.852 0.199 91.936)",
      "--primary-foreground": "oklch(0.421 0.095 57.708)",
      "--secondary": "oklch(0.967 0.001 286.375)",
      "--secondary-foreground": "oklch(0.21 0.006 285.885)",
      "--muted": "oklch(0.963 0.002 197.1)",
      "--muted-foreground": "oklch(0.56 0.021 213.5)",
      "--accent": "oklch(0.963 0.002 197.1)",
      "--accent-foreground": "oklch(0.218 0.008 223.9)",
      "--destructive": "oklch(0.577 0.245 27.325)",
      "--border": "oklch(0.925 0.005 214.3)",
      "--input": "oklch(0.925 0.005 214.3)",
      "--ring": "oklch(0.723 0.014 214.4)",
      "--sidebar": "oklch(1 0 0)",
      "--sidebar-foreground": "oklch(0.148 0.004 228.8)",
      "--sidebar-primary": "oklch(0.681 0.162 75.834)",
      "--sidebar-primary-foreground": "oklch(0.987 0.026 102.212)",
      "--sidebar-accent": "oklch(0.963 0.002 197.1)",
      "--sidebar-accent-foreground": "oklch(0.218 0.008 223.9)",
      "--sidebar-border": "oklch(0.925 0.005 214.3)",
      "--sidebar-ring": "oklch(0.723 0.014 214.4)",
      "--terminal-selection": "oklch(0.8 0.01 220 / 45%)",
      "--syntax-keyword": "oklch(0.55 0.16 290)",
      "--syntax-string": "oklch(0.49 0.13 155)",
      "--syntax-number": "oklch(0.52 0.16 40)",
      "--syntax-title": "oklch(0.52 0.14 220)",
    },
  };
}

export function nawcDark(): NawcTheme {
  return {
    name: "nawc-dark",
    appearance: "dark",
    variables: {
      ...sharedThemeVariables,
      "--background": "oklch(0.16 0.006 240)",
      "--foreground": "oklch(0.94 0.006 220)",
      "--card": "oklch(0.19 0.007 240)",
      "--card-foreground": "oklch(0.94 0.006 220)",
      "--popover": "oklch(0.19 0.007 240)",
      "--popover-foreground": "oklch(0.94 0.006 220)",
      "--primary": "oklch(0.8 0.17 91)",
      "--primary-foreground": "oklch(0.24 0.055 67)",
      "--secondary": "oklch(0.25 0.008 240)",
      "--secondary-foreground": "oklch(0.94 0.006 220)",
      "--muted": "oklch(0.23 0.008 230)",
      "--muted-foreground": "oklch(0.7 0.016 220)",
      "--accent": "oklch(0.28 0.012 220)",
      "--accent-foreground": "oklch(0.96 0.004 220)",
      "--destructive": "oklch(0.67 0.21 25)",
      "--border": "oklch(0.3 0.01 225)",
      "--input": "oklch(0.3 0.01 225)",
      "--ring": "oklch(0.66 0.02 215)",
      "--sidebar": "oklch(0.14 0.006 240)",
      "--sidebar-foreground": "oklch(0.94 0.006 220)",
      "--sidebar-primary": "oklch(0.8 0.17 91)",
      "--sidebar-primary-foreground": "oklch(0.24 0.055 67)",
      "--sidebar-accent": "oklch(0.23 0.008 230)",
      "--sidebar-accent-foreground": "oklch(0.96 0.004 220)",
      "--sidebar-border": "oklch(0.3 0.01 225)",
      "--sidebar-ring": "oklch(0.66 0.02 215)",
      "--terminal-selection": "oklch(0.55 0.02 220 / 55%)",
      "--syntax-keyword": "oklch(0.77 0.14 300)",
      "--syntax-string": "oklch(0.76 0.14 155)",
      "--syntax-number": "oklch(0.76 0.14 55)",
      "--syntax-title": "oklch(0.75 0.12 220)",
    },
  };
}

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

export type NawcProviderReasoningEffort = {
  readonly id: string;
  readonly description?: string;
};

export type NawcProviderSettings = {
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly reasoningEfforts?: readonly NawcProviderReasoningEffort[];
};

export type NawcProvider = {
  readonly name: string;
  readonly getSettings?: (input: { readonly cwd: string }) => Promise<NawcProviderSettings>;
  readonly listSkills?: (input: { readonly cwd: string }) => Promise<readonly NawcProviderSkill[]>;
  readonly listModels?: (input: { readonly cwd: string }) => Promise<readonly NawcProviderModel[]>;
  readonly slashCommands?: readonly NawcProviderSlashCommand[];
  prompt(input: {
    readonly prompt: string;
    readonly cwd: string;
    readonly skillsDir: string;
    readonly references?: readonly PromptReference[];
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly mode?: "default" | "plan";
  }): AsyncIterable<ProviderEvent>;
};

export type PromptReference =
  | { readonly type: "file"; readonly path: string }
  | { readonly type: "skill"; readonly name: string; readonly path: string };

export type NawcProviderSkill = {
  readonly name: string;
  readonly path: string;
  readonly enabled?: boolean;
  readonly scope?: string;
  readonly displayName?: string;
  readonly shortDescription?: string;
  readonly description?: string;
};

export type NawcProviderModel = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly reasoningEfforts?: readonly NawcProviderReasoningEffort[];
  readonly defaultReasoningEffort?: string;
  readonly isDefault?: boolean;
};

export type NawcProviderSlashCommand = {
  readonly name: string;
  readonly description?: string;
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

export function defineConfig<const T extends NawcConfig>(
  config: T,
): T & { readonly editor: NawcEditor; readonly theme: NawcTheme } {
  configShape.parse(config);
  return { ...config, editor: config.editor ?? vscode(), theme: config.theme ?? nawcLight() };
}

export function syntaxFor(config: NawcConfig, name?: string): NawcSyntax | undefined {
  if (!name) return undefined;
  return config.syntax.find((item) => item.name === name || item.aliases.includes(name));
}
