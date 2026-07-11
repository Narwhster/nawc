import { describe, expect, it } from "vitest";
import { defineConfig, syntaxFor, vscode, type NawcConfig } from "../src/index.ts";

const syntax = { name: "typescript", aliases: ["ts"], resolve: () => undefined };
const provider = { name: "test", async *prompt() {} };

describe("configuration", () => {
  it("preserves a valid typed configuration", () => {
    const config = defineConfig({
      plugins: [],
      provider,
      syntax: [syntax],
      baseDir: "..",
      port: 6292,
    });
    expect(config.baseDir).toBe("..");
    expect(config.editor.name).toBe("vscode");
  });

  it("opens VS Code through its registered URL handler at an exact source location", () => {
    expect(vscode().open({ file: "/repo/a file.ts", line: 12, column: 3 })).toEqual({
      type: "url",
      url: "vscode://file/repo/a%20file.ts:12:3",
    });
  });

  it("finds syntax adapters by alias", () => {
    const config = { plugins: [], provider, syntax: [syntax], baseDir: "." } satisfies NawcConfig;
    expect(syntaxFor(config, "ts")).toBe(syntax);
  });

  it("rejects invalid ports", () => {
    expect(() =>
      defineConfig({ plugins: [], provider, syntax: [], baseDir: ".", port: 70_000 }),
    ).toThrow();
  });
});
