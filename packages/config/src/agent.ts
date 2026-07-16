export type NawcAgentId = string;

export type NawcProviderCapability =
  | "attachments"
  | "interrupt"
  | "requests"
  | "resume"
  | "session-model-switch";

export type NawcProviderMode = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type NawcProviderReasoningEffort = {
  readonly id: string;
  readonly description?: string;
};

export type NawcProviderOption =
  | {
      readonly id: string;
      readonly label: string;
      readonly description?: string;
      readonly type: "select";
      readonly choices: readonly {
        readonly id: string;
        readonly label: string;
        readonly description?: string;
      }[];
      readonly defaultValue?: string;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly description?: string;
      readonly type: "boolean";
      readonly defaultValue?: boolean;
    };

export type NawcProviderOptionSelection = {
  readonly id: string;
  readonly value: string | boolean;
};

export type NawcProviderModel = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly contextWindow?: number;
  readonly reasoningEfforts?: readonly NawcProviderReasoningEffort[];
  readonly defaultReasoningEffort?: string;
  readonly isDefault?: boolean;
  readonly options?: readonly NawcProviderOption[];
};

export type NawcProviderSkill = {
  readonly name: string;
  readonly path: string;
  readonly enabled?: boolean;
  readonly scope?: string;
  readonly displayName?: string;
  readonly shortDescription?: string;
  readonly description?: string;
};

export type NawcProviderSlashCommand = {
  readonly name: string;
  readonly description?: string;
  readonly inputHint?: string;
};

export type NawcProviderSettings = {
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly options?: readonly NawcProviderOptionSelection[];
  readonly reasoningEfforts?: readonly NawcProviderReasoningEffort[];
};

export type PromptReference =
  | { readonly type: "file"; readonly path: string }
  | { readonly type: "skill"; readonly name: string; readonly path: string }
  | { readonly type: "note"; readonly path: string; readonly content?: string }
  | {
      readonly type: "diagnostic";
      readonly message: string;
      readonly file?: string;
      readonly line?: number;
    };

export type NawcAgentAttachment = {
  readonly type: "image";
  readonly id: NawcAgentId;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly dataUrl: string;
};

export type NawcProviderSession = {
  readonly id: NawcAgentId;
  readonly providerThreadId?: string;
};

export type ProviderEventBase = {
  readonly id?: NawcAgentId;
  readonly createdAt?: string;
  readonly turnId?: NawcAgentId;
  readonly itemId?: NawcAgentId;
  readonly payload?: unknown;
};

export type NawcProviderUsage = {
  readonly input?: number;
  readonly output?: number;
  readonly total?: number;
  readonly contextWindow?: number;
};

export type ProviderEvent = ProviderEventBase &
  (
    | { readonly type: "session.started"; readonly sessionId?: string }
    | { readonly type: "thread.started"; readonly threadId: string }
    | { readonly type: "turn.started" }
    | { readonly type: "turn.completed"; readonly usage?: NawcProviderUsage }
    | { readonly type: "context.updated"; readonly usage: NawcProviderUsage }
    | { readonly type: "turn.interrupted" }
    | { readonly type: "message.started"; readonly role?: "assistant" | "system" }
    | { readonly type: "message.delta"; readonly text: string }
    | { readonly type: "message.completed"; readonly text?: string }
    | {
        readonly type: "tool.started" | "tool.updated" | "tool.completed";
        readonly tool: string;
        readonly title: string;
        readonly status?: "running" | "completed" | "failed" | "declined";
        readonly output?: string;
      }
    | { readonly type: "plan.updated"; readonly markdown: string }
    | {
        readonly type: "request.opened";
        readonly requestId: string;
        readonly requestKind: string;
        readonly title: string;
        readonly details?: string;
      }
    | { readonly type: "request.resolved"; readonly requestId: string; readonly decision: string }
    | { readonly type: "warning"; readonly message: string }
    | { readonly type: "error"; readonly message: string }
    | { readonly type: "unknown"; readonly sourceType: string }
    // Legacy events remain accepted while providers migrate to sessions.
    | { readonly type: "message"; readonly text: string }
    | { readonly type: "command"; readonly command: string; readonly status: string }
    | { readonly type: "done" }
  );

export type NawcProviderTurnInput = {
  readonly prompt: string;
  readonly cwd: string;
  readonly skillsDir: string;
  readonly references: readonly PromptReference[];
  readonly attachments?: readonly NawcAgentAttachment[];
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly options?: readonly NawcProviderOptionSelection[];
  readonly mode?: string;
  readonly signal?: AbortSignal;
};

export type NawcProvider = {
  readonly name: string;
  readonly label?: string;
  readonly capabilities?: readonly NawcProviderCapability[];
  readonly modes?: readonly NawcProviderMode[];
  readonly getSettings?: (input: { readonly cwd: string }) => Promise<NawcProviderSettings>;
  readonly listSkills?: (input: {
    readonly cwd: string;
    readonly skillsDir?: string;
  }) => Promise<readonly NawcProviderSkill[]>;
  readonly listModels?: (input: { readonly cwd: string }) => Promise<readonly NawcProviderModel[]>;
  readonly listCommands?: (input: {
    readonly cwd: string;
  }) => Promise<readonly NawcProviderSlashCommand[]>;
  readonly slashCommands?: readonly NawcProviderSlashCommand[];
  startSession?(input: {
    readonly cwd: string;
    readonly providerThreadId?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly options?: readonly NawcProviderOptionSelection[];
    readonly mode?: string;
  }): Promise<NawcProviderSession>;
  sendTurn?(
    session: NawcProviderSession,
    input: NawcProviderTurnInput,
  ): AsyncIterable<ProviderEvent>;
  interrupt?(session: NawcProviderSession): Promise<void>;
  respondToRequest?(
    session: NawcProviderSession,
    requestId: string,
    decision: string,
  ): Promise<void>;
  closeSession?(session: NawcProviderSession): Promise<void>;
  prompt?(input: NawcProviderTurnInput): AsyncIterable<ProviderEvent>;
};
