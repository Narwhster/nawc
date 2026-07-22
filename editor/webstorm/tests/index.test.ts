import { describe, expect, it } from "vitest";
import { webstorm } from "../src/index.ts";

describe("webstorm editor", () => {
  it("invokes the WebStorm CLI launcher at an exact source location", () => {
    expect(webstorm().open({ file: "/repo/a file.ts", line: 12, column: 3 })).toEqual({
      type: "command",
      command: ["webstorm", "--line", "12", "--column", "3", "/repo/a file.ts"],
    });
  });

  it("omits the column flag when only a line is provided", () => {
    expect(webstorm().open({ file: "/repo/a file.ts", line: 1 })).toEqual({
      type: "command",
      command: ["webstorm", "--line", "1", "/repo/a file.ts"],
    });
  });

  it("invokes the CLI launcher without position flags when no line is given", () => {
    expect(webstorm().open({ file: "/repo/a file.ts" })).toEqual({
      type: "command",
      command: ["webstorm", "/repo/a file.ts"],
    });
  });
});
