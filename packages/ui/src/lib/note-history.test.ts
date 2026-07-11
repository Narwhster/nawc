import { describe, expect, it } from "vitest";
import { createNoteHistory, navigateHistory, peekHistory, recordNavigation } from "./note-history";

describe("note history", () => {
  it("tracks back and forward navigation", () => {
    const history = createNoteHistory();
    recordNavigation(history, "A.html", "B.html");
    recordNavigation(history, "B.html", "C.html");

    expect(peekHistory(history, "back")).toBe("B.html");
    expect(navigateHistory(history, "C.html", "back")).toBe("B.html");
    expect(navigateHistory(history, "B.html", "back")).toBe("A.html");
    expect(navigateHistory(history, "A.html", "forward")).toBe("B.html");
    expect(navigateHistory(history, "B.html", "forward")).toBe("C.html");
  });

  it("clears forward history after a new navigation", () => {
    const history = createNoteHistory();
    recordNavigation(history, "A.html", "B.html");
    expect(navigateHistory(history, "B.html", "back")).toBe("A.html");

    recordNavigation(history, "A.html", "C.html");

    expect(navigateHistory(history, "A.html", "forward")).toBeUndefined();
  });
});
