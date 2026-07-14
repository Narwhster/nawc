import { pathToFileURL } from "node:url";
import type { NawcEditor } from "@nawc/config";

export function vscode(): NawcEditor {
  return {
    name: "vscode",
    label: "VS Code",
    icon: {
      name: "vscode",
      viewBox: "0 0 24 24",
      paths: [
        "M17.6 2.1 8.4 10.4 3.2 6.5 1 7.8v8.4l2.2 1.3 5.2-3.9 9.2 8.3L23 19.3V4.7l-5.4-2.6Zm0 5.2v9.4l-6.2-4.7 6.2-4.7Z",
      ],
    },
    open: ({ file, line, column }) => ({
      type: "url",
      url: `vscode://file${pathToFileURL(file).pathname}${line ? `:${line}:${column ?? 1}` : ""}`,
    }),
  };
}
