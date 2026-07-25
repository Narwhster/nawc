import { defineStaticSiteConfig } from "@nawc/site";

export default defineStaticSiteConfig({
  files: { match: /(?:^|\/)(?:index|guide)\.html$/ },
  faq: ({ prompt, files, history }) => {
    const last = history[history.length - 1];

    if (prompt.toLowerCase().includes("included files")) {
      return {
        node: {
          type: "answer",
          text: `This guide can read ${files.length} bundled notebook notes.`,
        },
      };
    }

    if (last?.chosenAnswer === "Run TypeScript") {
      return {
        node: {
          type: "answer",
          text: "Open the **Examples** note and use the Run button on its TypeScript block.",
        },
      };
    }

    if (last?.chosenAnswer === "Edit a note") {
      return {
        node: {
          type: "question",
          question: "Do you need those edits to survive a refresh?",
          answers: [{ label: "No" }, { label: "Yes" }],
        },
      };
    }

    if (last?.chosenAnswer === "No") {
      return {
        node: {
          type: "answer",
          text: "Great—edit directly in the notebook. Static-site changes intentionally reset on refresh.",
        },
      };
    }

    if (last?.chosenAnswer === "Yes") {
      return {
        node: {
          type: "answer",
          text: "Install NAWC locally for filesystem-backed editing and a real agent.",
        },
      };
    }

    return {
      node: {
        type: "question",
        question: "What would you like to explore?",
        answers: [{ label: "Run TypeScript" }, { label: "Edit a note" }],
      },
    };
  },
});
