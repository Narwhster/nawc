import { describe, expect, it } from "vitest";
import type { NawcEditor } from "@nawc/config";
import { launchEditor, urlOpenCommand } from "../src/editor.ts";

describe("editor URL launching", () => {
  const url = "vscode://file/repo/a%20file.ts:12:3";

  it("uses the registered macOS URL handler", () => {
    expect(urlOpenCommand(url, "darwin")).toEqual(["open", url]);
  });

  it("uses the registered Windows URL handler without a shell", () => {
    expect(urlOpenCommand(url, "win32")).toEqual([
      "rundll32.exe",
      "url.dll,FileProtocolHandler",
      url,
    ]);
  });

  it("uses the desktop URL handler on Linux", () => {
    expect(urlOpenCommand(url, "linux")).toEqual(["xdg-open", url]);
  });
});

describe("launchEditor", () => {
  function fakeEditor(overrides: Partial<NawcEditor> = {}): NawcEditor {
    return {
      name: "test-editor",
      label: "Test Editor",
      open: () => ({ type: "command", command: ["__nawc_nonexistent_command__"] }),
      ...overrides,
    };
  }

  it("rejects with a VS Code shell-command hint when the code CLI is missing", async () => {
    const editor = fakeEditor({ name: "vscode", label: "VS Code" });
    await expect(launchEditor(editor, { file: "/repo/a.ts" })).rejects.toThrow(
      /VS Code.*Shell Command/,
    );
  });

  it("rejects with the create-command-line-launcher hint when the idea CLI is missing", async () => {
    const editor = fakeEditor({ name: "idea", label: "IntelliJ IDEA" });
    await expect(launchEditor(editor, { file: "/repo/a.ts" })).rejects.toThrow(
      /IntelliJ IDEA.*Tools.*Create Command-line Launcher/,
    );
  });

  it("rejects with a Zed CLI hint when the zed CLI is missing", async () => {
    const editor = fakeEditor({ name: "zed", label: "Zed" });
    await expect(launchEditor(editor, { file: "/repo/a.ts" })).rejects.toThrow(/Zed.*cli/i);
  });

  it("rejects with a generic PATH hint for unknown editors", async () => {
    const editor = fakeEditor({ name: "obscure-editor", label: "Obscure" });
    await expect(launchEditor(editor, { file: "/repo/a.ts" })).rejects.toThrow(/Obscure.*PATH/);
  });
});
