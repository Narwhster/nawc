import { describe, expect, it } from "vitest";
import { vscode } from "../src/index.ts";

describe("vscode editor", () => {
  it("opens VS Code through its registered URL handler at an exact source location", () => {
    expect(vscode().open({ file: "/repo/a file.ts", line: 12, column: 3 })).toEqual({
      type: "url",
      url: "vscode://file/repo/a%20file.ts:12:3",
    });
  });
});
