import { defineStaticAgent } from "@nawc/site";

export default defineStaticAgent({
  files: { match: /(?:^|\/)docs\// },
  faq: ({ prompt, files }) => {
    const lowered = prompt.toLowerCase();
    if (lowered.includes("install") || lowered.includes("get started")) {
      return {
        type: "question",
        question: "Which package manager are you using?",
        answers: [
          {
            label: "pnpm",
            child: {
              type: "answer",
              text: "Run `pnpm create nawc` and follow the setup prompts. The quick-start note has the full walkthrough.",
            },
          },
          {
            label: "npm",
            child: {
              type: "answer",
              text: "Run `npm create nawc` and follow the setup prompts. The quick-start note has the full walkthrough.",
            },
          },
          {
            label: "Something else",
            child: {
              type: "answer",
              text: "Open **docs/02-quick-start** for the current installation commands and supported package managers.",
            },
          },
        ],
      };
    }

    return {
      type: "question",
      question: "What do you want to learn about NAWC?",
      answers: [
        {
          label: "What it is",
          child: {
            type: "answer",
            text: "NAWC turns a folder of HTML notes into an editable notebook with project-aware code blocks and an agent panel. Start with **docs/01-introduction**.",
          },
        },
        {
          label: "Set up a notebook",
          child: {
            type: "answer",
            text: "Open **docs/02-quick-start**. This static guide currently includes " +
              `${files.length} documentation notes.`,
          },
        },
        {
          label: "Plugins and configuration",
          child: {
            type: "question",
            question: "Which part are you configuring?",
            answers: [
              {
                label: "Plugins",
                child: {
                  type: "answer",
                  text: "Open **docs/04-plugins** for supported nodes, syntax integrations, and plugin composition.",
                },
              },
              {
                label: "Provider, editor, or theme",
                child: {
                  type: "answer",
                  text: "Open **docs/03-configuration** and **docs/07-editors-and-themes**.",
                },
              },
            ],
          },
        },
      ],
    };
  },
});
