import { describe, expect, it } from "vitest";
import { cursor } from "../src/index.ts";

describe("cursor editor", () => {
  it("opens Cursor through the cursor CLI at an exact source location", () => {
    expect(cursor().open({ file: "/repo/a file.ts", line: 12, column: 3 })).toEqual({
      type: "command",
      command: ["cursor", "/repo/a file.ts:12:3"],
    });
  });

  it("opens Cursor through the cursor CLI without a position", () => {
    expect(cursor().open({ file: "/repo/a file.ts" })).toEqual({
      type: "command",
      command: ["cursor", "/repo/a file.ts"],
    });
  });
});
