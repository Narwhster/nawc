import { describe, expect, it } from "vitest";
import { configShape, syntaxFor, type NawcConfig } from "../src/index.ts";

const syntax = { name: "typescript", aliases: ["ts"], resolve: () => undefined };
const provider = { name: "test", async *prompt() {} };

describe("configuration", () => {
  it("validates a valid config shape", () => {
    const config = {
      plugins: [],
      provider,
      syntax: [syntax],
      baseDir: "..",
      port: 6292,
    };
    expect(() => configShape.parse(config)).not.toThrow();
  });

  it("finds syntax adapters by alias", () => {
    const config = { plugins: [], provider, syntax: [syntax], baseDir: "." } satisfies NawcConfig;
    expect(syntaxFor(config, "ts")).toBe(syntax);
  });

  it("rejects invalid ports", () => {
    expect(() =>
      configShape.parse({ plugins: [], provider, syntax: [], baseDir: ".", port: 70_000 }),
    ).toThrow();
  });
});
