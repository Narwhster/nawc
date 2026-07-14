import { definePlugin } from "@nawc/plugin";

export function core() {
  return definePlugin({
    name: "core",
    client: "@nawc/core/client",
    nodes: [
      { name: "interactive", tag: "interactive", description: "Sandboxed HTML prototype" },
      { name: "ref", tag: "ref", description: "Live source reference" },
      { name: "runnable", tag: "runnable", description: "Runnable source reference" },
    ],
  });
}
