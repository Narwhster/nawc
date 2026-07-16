import { describe, expect, it } from "vitest";
import {
  displayReference,
  prepareTurnReferences,
  promptReferenceKey,
} from "../src/agent-references.ts";

describe("agent references", () => {
  it("keys file, skill, note, and diagnostic references", () => {
    expect(promptReferenceKey({ type: "file", path: "src/a.ts" })).toBe("file:src/a.ts");
    expect(promptReferenceKey({ type: "skill", name: "probe", path: "/skills/probe" })).toBe(
      "skill:probe",
    );
    expect(promptReferenceKey({ type: "note", path: "Note.html", content: "body" })).toBe(
      "note:Note.html",
    );
    expect(promptReferenceKey({ type: "diagnostic", message: "bad", file: "a.ts", line: 2 })).toBe(
      "diagnostic:a.ts:2:bad",
    );
  });

  it("injects full content once, then path-only notes and omits reattached files/skills", () => {
    const attached: string[] = [];
    const note = { type: "note" as const, path: "Note.html", content: "<p>hello</p>" };
    const file = { type: "file" as const, path: "src/a.ts" };
    const skill = { type: "skill" as const, name: "probe", path: "/skills/probe" };

    expect(prepareTurnReferences([note, file, skill], attached)).toEqual([note, file, skill]);
    expect(attached).toEqual(["note:Note.html", "file:src/a.ts", "skill:probe"]);

    expect(prepareTurnReferences([note, file, skill], attached)).toEqual([
      { type: "note", path: "Note.html" },
    ]);
    expect(attached).toEqual(["note:Note.html", "file:src/a.ts", "skill:probe"]);
  });

  it("still fully attaches a new note path in the same thread", () => {
    const attached = ["note:Old.html"];
    const next = { type: "note" as const, path: "New.html", content: "fresh" };
    expect(prepareTurnReferences([next], attached)).toEqual([next]);
    expect(attached).toEqual(["note:Old.html", "note:New.html"]);
  });

  it("strips note content for display metadata", () => {
    expect(displayReference({ type: "note", path: "Note.html", content: "<p>huge</p>" })).toEqual({
      type: "note",
      path: "Note.html",
    });
    expect(displayReference({ type: "file", path: "a.ts" })).toEqual({
      type: "file",
      path: "a.ts",
    });
  });
});
