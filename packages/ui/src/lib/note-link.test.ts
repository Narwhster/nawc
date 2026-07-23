import { describe, expect, it } from "vitest";
import { noteLinkHref, parseNoteLink } from "./note-link";

describe("note links", () => {
  it("builds encoded note paths", () => {
    expect(noteLinkHref("Architecture")).toBe("/note/Architecture.html");
    expect(noteLinkHref("docs/Ticket.html")).toBe("/note/docs/Ticket.html");
    expect(noteLinkHref("docs/My Note")).toBe("/note/docs/My%20Note.html");
  });

  it("parses note links regardless of host", () => {
    expect(parseNoteLink("/note/Architecture.html", "http://localhost:6292")).toBe(
      "Architecture.html",
    );
    expect(
      parseNoteLink("http://localhost:6292/note/docs/Ticket.html", "http://127.0.0.1:6292"),
    ).toBe("docs/Ticket.html");
    expect(
      parseNoteLink("http://localhost:6292/note/docs/My%20Note.html", "http://localhost:6292"),
    ).toBe("docs/My Note.html");
  });

  it("ignores other routes and escapes", () => {
    expect(parseNoteLink("/api/note?path=Architecture.html", "http://localhost:6292")).toBe(
      undefined,
    );
    expect(parseNoteLink("/note/../secret.html", "http://localhost:6292")).toBe(undefined);
    expect(parseNoteLink("/note//Architecture.html", "http://localhost:6292")).toBe(undefined);
    expect(parseNoteLink("https://example.com/docs", "http://localhost:6292")).toBe(undefined);
  });

  it("reads static-site note routes from the hash", () => {
    expect(parseNoteLink("https://example.com/docs/#/note/guides/start.html")).toBe(
      "guides/start.html",
    );
  });
});
