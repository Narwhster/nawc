import { describe, expect, it } from "vitest";
import { configShape, syntaxFor, type NawcConfig } from "../src/index.ts";

const syntax = { name: "typescript", aliases: ["ts"], resolve: () => undefined };
const provider = { name: "test", async *prompt() {} };

describe("configuration", () => {
  it("validates a valid config shape", () => {
    const config = {
      plugins: [{ name: "typescript", syntax: [syntax] }],
      provider,
      baseDir: "..",
      port: 6292,
      host: "0.0.0.0",
    };
    expect(() => configShape.parse(config)).not.toThrow();
  });

  it("finds syntax adapters by alias", () => {
    const config = {
      plugins: [{ name: "typescript", syntax: [syntax] }],
      provider,
      baseDir: ".",
    } satisfies NawcConfig;
    expect(syntaxFor(config, "ts")).toBe(syntax);
  });

  it("rejects the legacy top-level syntax configuration", () => {
    expect(() => configShape.parse({ plugins: [], provider, syntax: [], baseDir: "." })).toThrow();
  });

  it("rejects invalid ports", () => {
    expect(() =>
      configShape.parse({ plugins: [], provider, baseDir: ".", port: 70_000 }),
    ).toThrow();
  });

  it("rejects an empty host", () => {
    expect(() => configShape.parse({ plugins: [], provider, baseDir: ".", host: "" })).toThrow();
  });
});
