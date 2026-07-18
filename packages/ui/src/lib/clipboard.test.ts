// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

function setClipboard(value: Pick<Clipboard, "writeText"> | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value,
  });
}

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value,
  });
}

describe("copyText", () => {
  afterEach(() => {
    setClipboard(undefined);
    setSecureContext(false);
    vi.restoreAllMocks();
  });

  it("uses the async clipboard API in a secure context", async () => {
    const writeText = vi.fn(async () => {});
    setSecureContext(true);
    setClipboard({ writeText });

    await copyText("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to document copy when the async API is unavailable", async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await copyText("hello");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports when both clipboard paths fail", async () => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });

    await expect(copyText("hello")).rejects.toThrow("Clipboard access is unavailable");
  });
});
