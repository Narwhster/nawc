import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { htmlText, NoteSearchIndex } from "../src/note-search.ts";

describe("note search", () => {
  it("extracts visible text without markup, scripts, styles, or attributes", () => {
    expect(
      htmlText(
        '<h1 data-noise="unfindable">Hello &amp; welcome</h1><style>hidden style</style><script>hidden script</script><p>Useful text</p>',
      ),
    ).toBe("Hello & welcome Useful text");
  });

  it("ranks titles above body text and refreshes after invalidation", async () => {
    const src = await mkdtemp(path.join(tmpdir(), "nawc-search-"));
    await mkdir(path.join(src, "folder"));
    await writeFile(path.join(src, "Alpha.html"), "<p>ordinary words</p>");
    await writeFile(path.join(src, "folder", "Other.html"), "<p>Alpha appears in the body</p>");
    const index = new NoteSearchIndex(src);

    expect((await index.search("alpha")).map(({ path: note }) => note)).toEqual([
      "Alpha.html",
      "folder/Other.html",
    ]);

    await writeFile(path.join(src, "New.html"), "<p>A newly searchable phrase</p>");
    expect(await index.search("newly searchable")).toEqual([]);
    index.invalidate();
    expect((await index.search("newly searchable"))[0]?.path).toBe("New.html");
  });

  it("supports prefix and typo-tolerant searches", async () => {
    const src = await mkdtemp(path.join(tmpdir(), "nawc-search-"));
    await writeFile(path.join(src, "Architecture.html"), "<p>Dependency boundaries</p>");
    const index = new NoteSearchIndex(src);

    expect((await index.search("architec"))[0]?.path).toBe("Architecture.html");
    expect((await index.search("dependncy"))[0]?.path).toBe("Architecture.html");
  });
});
