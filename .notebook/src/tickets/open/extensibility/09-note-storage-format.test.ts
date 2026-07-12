import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { listNotes } from "../../../../../packages/nawc/src/workspace.ts";

export async function noteStorage(root: string) {
  return listNotes(root);
}

it("lists notes using the configured document format", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nawc-note-format-"));
  try {
    await writeFile(path.join(root, "architecture.md"), "# Architecture", "utf8");
    expect(await noteStorage(root)).toContain("architecture.md");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
