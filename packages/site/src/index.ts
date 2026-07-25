export type StaticAgentFile = {
  readonly path: string;
  readonly content: string;
};

export type StaticAgentHistoryEntry = {
  readonly label?: string;
  readonly question: string;
  readonly chosenAnswer: string;
};

export type StaticAgentAnswer = {
  readonly type: "answer";
  readonly text: string;
};

export type StaticAgentQuestion = {
  readonly type: "question";
  readonly title?: string;
  readonly label?: string;
  readonly question: string;
  readonly allowCustom?: boolean;
  readonly answers: readonly {
    readonly label: string;
  }[];
};

export type StaticAgentToolCall = {
  readonly type: "tool_call";
  readonly tool: string;
  readonly title: string;
  readonly duration?: number;
};

export type StaticAgentDelay = {
  readonly type: "delay";
  readonly ms: number;
};

export type StaticAgentSequence = {
  readonly type: "sequence";
  readonly steps: readonly (StaticAgentToolCall | StaticAgentDelay | StaticAgentAnswer)[];
};

export type StaticAgentNode = StaticAgentAnswer | StaticAgentQuestion | StaticAgentSequence;

export type StaticAgentFaqResult = {
  readonly node: StaticAgentNode;
  readonly sideEffect?: () => void;
};

export type StaticSiteConfig = {
  readonly metadata?: {
    readonly title: string;
    readonly description: string;
    readonly canonicalUrl: string;
    readonly image?: string;
  };
  readonly files: {
    readonly match: RegExp;
  };
  readonly faq: (input: {
    readonly prompt: string;
    readonly files: readonly StaticAgentFile[];
    readonly history: readonly StaticAgentHistoryEntry[];
    readonly note?: string;
  }) => StaticAgentFaqResult;
  readonly homeNote?: string;
};

export function defineStaticSiteConfig<const T extends StaticSiteConfig>(config: T): T {
  return config;
}
