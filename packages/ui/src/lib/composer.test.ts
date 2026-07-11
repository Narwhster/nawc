import { describe, expect, it } from "vitest";
import {
  collectPromptReferences,
  completeComposerTrigger,
  detectComposerTrigger,
} from "./composer";

describe("composer completions", () => {
  it("detects the active token at the caret", () => {
    expect(detectComposerTrigger("review @src/ind later", 15)).toEqual({
      kind: "file",
      query: "src/ind",
      start: 7,
      end: 15,
    });
    expect(detectComposerTrigger("use $test", 9)?.kind).toBe("skill");
    expect(detectComposerTrigger("/pla", 4)).toEqual({
      kind: "slash-command",
      query: "pla",
      start: 0,
      end: 4,
    });
    expect(detectComposerTrigger("/model gpt", 10)).toEqual({
      kind: "slash-model",
      query: "gpt",
      start: 0,
      end: 10,
    });
    expect(detectComposerTrigger("/reasoning high", 15)).toEqual({
      kind: "slash-reasoning",
      query: "high",
      start: 0,
      end: 15,
    });
    expect(detectComposerTrigger("email@example.com", 17)).toBeUndefined();
  });

  it("replaces only the active token and quotes paths containing spaces", () => {
    const trigger = detectComposerTrigger("open @src/Old next", 13)!;
    expect(completeComposerTrigger("open @src/Old next", trigger, "src/My Note.ts")).toEqual({
      text: 'open @"src/My Note.ts" next',
      cursor: 22,
    });
  });

  it("collects unique structured file and skill references", () => {
    expect(collectPromptReferences('read @"src/My Note.ts" with $testing and $testing')).toEqual([
      { type: "file", path: "src/My Note.ts" },
      { type: "skill", name: "testing" },
    ]);
  });

  it("derives references from the current text after paste, edit, and deletion", () => {
    const pasted = 'inspect @"src/My Note.ts" with $testing ';
    expect(collectPromptReferences(pasted)).toHaveLength(2);
    expect(collectPromptReferences(pasted.replace("$testing ", ""))).toEqual([
      { type: "file", path: "src/My Note.ts" },
    ]);
    expect(collectPromptReferences("plain prompt")).toEqual([]);
  });
});
