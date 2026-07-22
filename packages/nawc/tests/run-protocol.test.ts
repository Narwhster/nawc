import { describe, expect, it } from "vitest";
import { isPreviewRequest, isSameOrigin, parseRunClientEvent } from "../src/run-protocol.ts";

describe("runnable WebSocket boundary", () => {
  it("only accepts the HTTP origin that matches the requested host", () => {
    expect(isSameOrigin("http://localhost:6292", "localhost:6292")).toBe(true);
    expect(isSameOrigin("http://127.0.0.1:6292", "127.0.0.1:6292")).toBe(true);
    expect(isSameOrigin("http://100.64.0.10:6292", "100.64.0.10:6292", true)).toBe(true);
    expect(isSameOrigin("https://evil.example", "localhost:6292")).toBe(false);
    expect(isSameOrigin("http://100.64.0.11:6292", "100.64.0.10:6292")).toBe(false);
    expect(isSameOrigin("http://localhost.evil.example:6292", "localhost:6292")).toBe(false);
    expect(isSameOrigin("http://evil.example:6292", "evil.example:6292")).toBe(false);
    expect(isSameOrigin(undefined, "localhost:6292")).toBe(false);
  });

  it("keeps sandboxed previews away from the notebook APIs", () => {
    expect(isPreviewRequest("null", "100.81.9.68:6292")).toBe(true);
    expect(isSameOrigin("null", "100.81.9.68:6292", true)).toBe(false);
    expect(isPreviewRequest("http://100.81.9.68:6292", "100.81.9.68:6292")).toBe(false);
    expect(isPreviewRequest(undefined, "127.0.0.1:6292")).toBe(true);
  });

  it("validates start, input, and resize messages", () => {
    expect(
      parseRunClientEvent(
        JSON.stringify({
          type: "start",
          selection: { file: "src/example.ts", syntax: "ts" },
          cols: 80,
          rows: 24,
        }),
      ),
    ).toEqual({
      type: "start",
      selection: { file: "src/example.ts", syntax: "ts" },
      cols: 80,
      rows: 24,
    });
    expect(parseRunClientEvent(JSON.stringify({ type: "input", data: "hello\r" }))).toEqual({
      type: "input",
      data: "hello\r",
    });
    expect(parseRunClientEvent(JSON.stringify({ type: "resize", cols: 120, rows: 30 }))).toEqual({
      type: "resize",
      cols: 120,
      rows: 30,
    });
    expect(
      parseRunClientEvent(
        JSON.stringify({
          type: "start",
          selection: { file: "", source: "console.log(42)", syntax: "ts" },
          cols: 80,
          rows: 24,
        }),
      ),
    ).toEqual({
      type: "start",
      selection: { file: "", source: "console.log(42)", syntax: "ts" },
      cols: 80,
      rows: 24,
    });
  });

  it("rejects malformed events and non-finite terminal dimensions", () => {
    expect(parseRunClientEvent("not json")).toBeUndefined();
    expect(
      parseRunClientEvent(JSON.stringify({ type: "start", selection: {}, cols: 80, rows: 24 })),
    ).toBeUndefined();
    expect(parseRunClientEvent(JSON.stringify({ type: "input", data: 42 }))).toBeUndefined();
    expect(
      parseRunClientEvent(JSON.stringify({ type: "resize", cols: "80", rows: 24 })),
    ).toBeUndefined();
    expect(
      parseRunClientEvent(JSON.stringify({ type: "resize", cols: null, rows: 24 })),
    ).toBeUndefined();
    expect(
      parseRunClientEvent(JSON.stringify({ type: "resize", cols: 80.5, rows: 24 })),
    ).toBeUndefined();
    expect(parseRunClientEvent(`{"type":"resize","cols":1e999,"rows":24}`)).toBeUndefined();
  });
});
