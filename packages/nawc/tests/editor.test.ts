import { describe, expect, it } from "vitest";
import { urlOpenCommand } from "../src/editor.ts";

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
