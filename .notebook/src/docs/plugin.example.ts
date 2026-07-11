import { definePlugin } from "@nawc/plugin";

export const diagrams = () =>
  definePlugin({
    name: "diagrams",
    client: "@acme/nawc-diagrams/client",
    nodes: [{ name: "diagram", tag: "diagram", description: "Editable diagram" }],
    skills: [{ name: "diagrams", content: "# Diagrams\nUse <diagram>..." }],
  });
