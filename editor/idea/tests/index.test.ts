import { describe, expect, it } from "vitest";
import { idea } from "../src/index.ts";

describe("idea editor", () => {
  it("invokes the IntelliJ IDEA CLI launcher at an exact source location", () => {
    expect(idea().open({ file: "/repo/a file.ts", line: 12, column: 3 })).toEqual({
      type: "command",
      command: ["idea", "--line", "12", "--column", "3", "/repo/a file.ts"],
    });
  });

  it("omits the column flag when only a line is provided", () => {
    expect(idea().open({ file: "/repo/a file.ts", line: 1 })).toEqual({
      type: "command",
      command: ["idea", "--line", "1", "/repo/a file.ts"],
    });
  });

  it("invokes the CLI launcher without position flags when no line is given", () => {
    expect(idea().open({ file: "/repo/a file.ts" })).toEqual({
      type: "command",
      command: ["idea", "/repo/a file.ts"],
    });
  });
});
