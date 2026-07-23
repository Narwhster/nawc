import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadStaticNotebookData } from "../src/build.ts";

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
