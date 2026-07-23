export type StaticAgentFile = {
  readonly path: string;
  readonly content: string;
};

export type StaticAgentHistoryEntry = {
  readonly question: string;
  readonly chosenAnswer: string;
};

export type StaticAgentAnswer = {
  readonly type: "answer";
  readonly text: string;
};

export type StaticAgentQuestion = {
  readonly type: "question";
  readonly question: string;
  readonly answers: readonly {
    readonly label: string;
    readonly child: StaticAgentConversationTree;
  }[];
};

export type StaticAgentConversationTree = StaticAgentAnswer | StaticAgentQuestion;

export type StaticAgentConfig = {
  readonly files: {
    readonly match: RegExp;
  };
  readonly faq: (input: {
    readonly prompt: string;
    readonly files: readonly StaticAgentFile[];
    readonly history: readonly StaticAgentHistoryEntry[];
  }) => StaticAgentConversationTree;
};

export function defineStaticAgent<const T extends StaticAgentConfig>(config: T): T {
  return config;
}
