import { describe, expect, it } from "vitest";
import { zed } from "../src/index.ts";

describe("zed editor", () => {
  it("opens Zed through its registered URL handler at an exact source location", () => {
    expect(zed().open({ file: "/repo/a file.ts", line: 12, column: 3 })).toEqual({
      type: "url",
      url: "zed://file/repo/a%20file.ts:12:3",
    });
  });

  it("omits the position when no line is provided", () => {
    expect(zed().open({ file: "/repo/a file.ts" })).toEqual({
      type: "url",
      url: "zed://file/repo/a%20file.ts",
    });
  });
});
