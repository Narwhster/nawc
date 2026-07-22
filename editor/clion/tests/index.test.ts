import { describe, expect, it } from "vitest";
import { clion } from "../src/index.ts";

describe("clion editor", () => {
  it("invokes the CLion CLI launcher at an exact source location", () => {
    expect(clion().open({ file: "/repo/a file.ts", line: 12, column: 3 })).toEqual({
      type: "command",
      command: ["clion", "--line", "12", "--column", "3", "/repo/a file.ts"],
    });
  });

  it("omits the column flag when only a line is provided", () => {
    expect(clion().open({ file: "/repo/a file.ts", line: 1 })).toEqual({
      type: "command",
      command: ["clion", "--line", "1", "/repo/a file.ts"],
    });
  });

  it("invokes the CLI launcher without position flags when no line is given", () => {
    expect(clion().open({ file: "/repo/a file.ts" })).toEqual({
      type: "command",
      command: ["clion", "/repo/a file.ts"],
    });
  });
});
