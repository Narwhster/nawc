// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { notePath, WikiLink } from "./wiki-link";

describe("wiki links", () => {
  it("normalizes legacy browser links into wiki links", () => {
    const editor = new Editor({
      extensions: [WikiLink, StarterKit],
      content: '<p><a target="_blank" href="#Architecture">[[Architecture]]</a></p>',
    });

    expect(editor.getHTML()).toBe(
      '<p><a data-wiki-link="Architecture" href="#Architecture">[[Architecture]]</a></p>',
    );
    editor.destroy();
  });

  it("preserves explicit note paths", () => {
    expect(notePath("Architecture")).toBe("Architecture.html");
    expect(notePath("docs/Architecture.html")).toBe("docs/Architecture.html");
  });
});
