// .notebook/src/tickets/closed/static-agent-probe.example.ts
//
// What a notebook author's `nawc-site.config.ts` will look like in practice.
// This file imports from `@nawc/site`, which does not exist yet — that is
// intentional. The typecheck failure here is a signal that the static-site
// config implementation ticket is not done.

import { defineStaticSiteConfig } from "@nawc/site";

export default defineStaticSiteConfig({
  files: { match: /\/(docs|tickets)\// },
  faq: ({ prompt, history }) => {
    const lowered = prompt.toLowerCase();
    const last = history[history.length - 1];

    if (last?.chosenAnswer === "pnpm") {
      return {
        node: {
          type: "answer",
          text: "Run `pnpm add nawc` to install NAWC, then `pnpm create nawc .nawc` to scaffold a notebook.",
        },
      };
    }

    if (last?.chosenAnswer === "npm") {
      return {
        node: {
          type: "answer",
          text: "Run `npm install nawc`, then `npx create-nawc .nawc` to scaffold a notebook.",
        },
      };
    }

    if (last?.chosenAnswer === "Other / not sure") {
      return {
        node: {
          type: "question",
          question: "Want me to recommend one?",
          answers: [{ label: "Yes" }, { label: "No, I'll figure it out" }],
        },
      };
    }

    if (last?.chosenAnswer === "Yes") {
      return {
        node: {
          type: "answer",
          text: "NAWC officially supports pnpm. Install it from https://pnpm.io/installation.",
        },
      };
    }

    if (last?.chosenAnswer === "No, I'll figure it out") {
      return {
        node: {
          type: "answer",
          text: "Sounds good. Come back any time you get stuck.",
        },
      };
    }

    if (last?.chosenAnswer === "Install NAWC") {
      return {
        node: {
          type: "answer",
          text: "Start with the quick start: see the `docs/02-quick-start` note.",
        },
      };
    }

    if (last?.chosenAnswer === "Configure a notebook") {
      return {
        node: {
          type: "answer",
          text: "See `docs/03-configuration` for plugins, provider, editor, and theme.",
        },
      };
    }

    if (last?.chosenAnswer === "Something else") {
      return {
        node: {
          type: "answer",
          text: "I'm a small FAQ agent for this site. For anything else, run NAWC locally and ask the real agent.",
        },
      };
    }

    if (lowered.includes("install") || lowered.includes("get started")) {
      return {
        node: {
          type: "question",
          question: "Which package manager are you on?",
          answers: [{ label: "pnpm" }, { label: "npm" }, { label: "Other / not sure" }],
        },
      };
    }

    return {
      node: {
        type: "question",
        question: "What can I help with?",
        answers: [
          { label: "Install NAWC" },
          { label: "Configure a notebook" },
          { label: "Something else" },
        ],
      },
    };
  },
});
