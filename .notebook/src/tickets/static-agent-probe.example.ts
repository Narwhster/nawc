// .notebook/src/tickets/static-agent-probe.example.ts
//
// What a notebook author's `nawc-static-agent.ts` will look like in practice.
// This file imports from `@nawc/site`, which does not exist yet — that is
// intentional. The typecheck failure here is a signal that the static-agent
// implementation ticket is not done.

import { defineStaticAgent } from "@nawc/site";

export default defineStaticAgent({
  files: { match: /\/(docs|tickets)\// },
  faq: ({ prompt, files, history }) => {
    const lowered = prompt.toLowerCase();

    if (lowered.includes("install") || lowered.includes("get started")) {
      return {
        type: "question",
        question: "Which package manager are you on?",
        answers: [
          {
            label: "pnpm",
            child: {
              type: "answer",
              text: "Run `pnpm add nawc` to install NAWC, then `pnpm create nawc .nawc` to scaffold a notebook.",
            },
          },
          {
            label: "npm",
            child: {
              type: "answer",
              text: "Run `npm install nawc`, then `npx create-nawc .nawc` to scaffold a notebook.",
            },
          },
          {
            label: "Other / not sure",
            child: {
              type: "question",
              question: "Want me to recommend one?",
              answers: [
                {
                  label: "Yes",
                  child: {
                    type: "answer",
                    text: "NAWC officially supports pnpm. Install it from https://pnpm.io/installation.",
                  },
                },
                {
                  label: "No, I'll figure it out",
                  child: {
                    type: "answer",
                    text: "Sounds good. Come back any time you get stuck.",
                  },
                },
              ],
            },
          },
        ],
      };
    }

    return {
      type: "question",
      question: "What can I help with?",
      answers: [
        {
          label: "Install NAWC",
          child: {
            type: "answer",
            text: "Start with the quick start: see the `docs/02-quick-start` note.",
          },
        },
        {
          label: "Configure a notebook",
          child: {
            type: "answer",
            text: "See `docs/03-configuration` for plugins, provider, editor, and theme.",
          },
        },
        {
          label: "Something else",
          child: {
            type: "answer",
            text: "I'm a small FAQ agent for this site. For anything else, run NAWC locally and ask the real agent.",
          },
        },
      ],
    };
  },
});
