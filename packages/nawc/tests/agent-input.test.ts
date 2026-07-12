import { describe, expect, it } from "vitest";
import { validateAgentAttachments } from "../src/agent-input.ts";

describe("validateAgentAttachments", () => {
  it("accepts a bounded image whose declared and encoded sizes agree", () => {
    expect(
      validateAgentAttachments([
        {
          type: "image",
          id: "image-1",
          name: "screen.png",
          mimeType: "image/png",
          sizeBytes: 4,
          dataUrl: "data:image/png;base64,dGVzdA==",
        },
      ]),
    ).toHaveLength(1);
  });

  it("rejects forged size metadata", () => {
    expect(() =>
      validateAgentAttachments([
        {
          type: "image",
          id: "image-1",
          name: "screen.png",
          mimeType: "image/png",
          sizeBytes: 1,
          dataUrl: "data:image/png;base64,dGVzdA==",
        },
      ]),
    ).toThrow("Invalid agent image attachment");
  });
});
