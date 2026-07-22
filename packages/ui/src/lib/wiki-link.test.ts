// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { notePath, WikiLink, wikiLinkMenuPosition, wikiLinkQuery } from "./wiki-link";

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

  it("finds the complete wiki-link text that autocomplete must replace", () => {
    const editor = new Editor({ extensions: [WikiLink, StarterKit], content: "<p>See [[arch</p>" });
    editor.commands.focus("end");
    expect(wikiLinkQuery(editor.state)).toEqual({ from: 5, to: 11, query: "arch" });
    editor.destroy();
  });

  it("places autocomplete above the cursor when the keyboard constrains the viewport", () => {
    expect(
      wikiLinkMenuPosition(
        { top: 420, bottom: 440, left: 20 },
        { width: 256, height: 200 },
        { top: 0, left: 0, width: 400, height: 500 },
      ),
    ).toEqual({ left: 20, top: 216 });
  });
});
