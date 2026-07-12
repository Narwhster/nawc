import { describe, expect, it } from "vitest";
import { shouldApplyExternalContent } from "./editor-sync";

describe("external editor content", () => {
  it("applies a filesystem change when the editor is clean", () => {
    expect(shouldApplyExternalContent("<p>old</p>", "<p>new</p>", false)).toBe(true);
  });

  it("does not replace unsaved local edits", () => {
    expect(shouldApplyExternalContent("<p>local</p>", "<p>external</p>", true)).toBe(false);
  });

  it("ignores a filesystem echo of the current document", () => {
    expect(shouldApplyExternalContent("<p>same</p>", "<p>same</p>", true)).toBe(false);
  });
});
