import { defineStaticAgent } from "@nawc/site";

export default defineStaticAgent({
  files: { match: /(?:^|\/)(?:index|guide)\.html$/ },
  faq: ({ prompt, files }) => {
    if (prompt.toLowerCase().includes("included files")) {
      return {
        type: "answer",
        text: `This guide can read ${files.length} bundled notebook notes.`,
      };
    }
    return {
      type: "question",
      question: "What would you like to explore?",
      answers: [
        {
          label: "Run TypeScript",
          child: {
            type: "answer",
            text: "Open the **Examples** note and use the Run button on its TypeScript block.",
          },
        },
        {
          label: "Edit a note",
          child: {
            type: "question",
            question: "Do you need those edits to survive a refresh?",
            answers: [
              {
                label: "No",
                child: {
                  type: "answer",
                  text: "Great—edit directly in the notebook. Static-site changes intentionally reset on refresh.",
                },
              },
              {
                label: "Yes",
                child: {
                  type: "answer",
                  text: "Install NAWC locally for filesystem-backed editing and a real agent.",
                },
              },
            ],
          },
        },
      ],
    };
  },
});
