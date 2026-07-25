import type { EditorLocation, NawcEditor } from "@nawc/config";
import { expect, it } from "vitest";
import { launchEditor } from "../../../../packages/nawc/src/editor.ts";

export function editorLocation(file: string, scope: "note" | "source") {
  return { file, scope };
}

it("passes note/source context to the configured editor", async () => {
  let received: EditorLocation | undefined;
  const editor: NawcEditor = {
    name: "test-editor",
    label: "Test Editor",
    open: (location) => {
      received = location;
      return { type: "command", command: [process.execPath, "-e", ""] };
    },
  };
  await launchEditor(editor, { file: "AGENTS.md", line: 4 });
  expect(received).toMatchObject({ scope: "source" });
});
