import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, detectPackageManager, packageName } from "../src/create.ts";

describe("create-nawc", () => {
  it("detects the invoking package manager", () =>
    expect(detectPackageManager("pnpm/11.0.0 npm/? node/v24")).toBe("pnpm"));
  it("normalizes project names", () => expect(packageName("/tmp/My Notebook")).toBe("my-notebook"));
  it("creates a deterministic notebook without installing", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "create-nawc-"));
    const root = path.join(parent, "docs");
    await createProject({ directory: root, packageManager: "pnpm", install: false });
    await expect(readFile(path.join(root, "nawc.config.ts"), "utf8")).resolves.toContain(
      "plugins: [core()]",
    );
    await expect(readFile(path.join(root, "nawc.config.ts"), "utf8")).resolves.toContain(
      "editor: vscode()",
    );
    await expect(readFile(path.join(root, "src/Welcome.html"), "utf8")).resolves.toContain(
      "<interactive>",
    );
  });
});
