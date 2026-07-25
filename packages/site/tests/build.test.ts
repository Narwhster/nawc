import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadStaticNotebookData, renderStaticMetadata } from "../src/build.ts";

describe("renderStaticMetadata", () => {
  it("adds static-site metadata without changing local notebook HTML", () => {
    const html = renderStaticMetadata(
      "<html><head><title>NAWC</title></head><body></body></html>",
      {
        title: "NAWC - A notebook for your agents",
        description: "Ideas & evidence",
        canonicalUrl: "https://nawc.dev/",
        image: "https://nawc.dev/social-card.png",
      },
    );

    expect(html).toContain("<title>NAWC - A notebook for your agents</title>");
    expect(html).toContain('content="Ideas &amp; evidence"');
    expect(html).toContain('rel="canonical" href="https://nawc.dev/"');
    expect(html).toContain('property="og:image" content="https://nawc.dev/social-card.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });
});

describe("loadStaticNotebookData", () => {
  it("bundles notes and referenced files while disabling unsupported runnables", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "nawc-site-"));
    await mkdir(path.join(projectDir, "src"));
    await writeFile(
      path.join(projectDir, "nawc.config.ts"),
      [
        "export default {",
        '  baseDir: ".",',
        '  plugins: [{ name: "core" }, { name: "typescript" }],',
        '  provider: { name: "test" },',
        '  theme: { name: "test", appearance: "light", variables: {} },',
        "};",
      ].join("\n"),
    );
    await writeFile(
      path.join(projectDir, "src/index.html"),
      [
        "<h1>Example</h1>",
        '<runnable syntax="typescript">console.log("works")</runnable>',
        '<runnable file="example.rs" syntax="rust"></runnable>',
      ].join("\n"),
    );
    await writeFile(path.join(projectDir, "example.rs"), 'fn main() { println!("hello"); }\n');

    const data = await loadStaticNotebookData(projectDir);

    expect(data.notes["index.html"]).toContain('<runnable syntax="typescript">');
    expect(data.notes["index.html"]).toContain('<code file="example.rs" syntax="rust">');
    expect(data.notes["index.html"]).not.toContain('<runnable file="example.rs"');
    expect(data.sources["example.rs"]).toContain("fn main()");
    expect(data.plugins.map((plugin) => plugin.name)).toEqual(["core", "typescript"]);
  });
});
