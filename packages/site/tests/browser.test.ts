// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { installStaticRuntime, runStaticSource } from "../src/browser.js";

const originalFetch = window.fetch;
const originalEventSource = window.EventSource;

afterEach(() => {
  window.fetch = originalFetch;
  window.EventSource = originalEventSource;
  delete window.__nawcBrowserRun;
  window.history.replaceState(null, "", "/");
});

describe("static browser runtime", () => {
  it("runs TypeScript entirely in the browser", async () => {
    const output: string[] = [];

    await runStaticSource(
      'const answer: number = 6 * 7; console.log("The answer is", answer);',
      "typescript",
      (data) => output.push(data),
    );

    expect(output).toEqual(["The answer is 42\n"]);
  });

  it("provides mutable in-memory notes and a static FAQ agent", async () => {
    installStaticRuntime({
      notes: {
        "index.html": "<h1>Home</h1>",
        "docs/guide.html": "<h1>Guide</h1>",
      },
      sources: {},
      theme: { name: "default", appearance: "light", variables: {} },
      plugins: [],
      agent: {
        files: { match: /\.html$/ },
        faq: () => ({
          type: "question",
          question: "What do you want to know?",
          answers: [
            {
              label: "Deploying",
              child: {
                type: "answer",
                text: "Upload the generated directory to any static host.",
              },
            },
          ],
        }),
      },
    });

    const notes = await window.fetch("/api/notes").then((response) => response.json());
    expect(notes).toHaveLength(2);

    await window.fetch("/api/note", {
      method: "PUT",
      body: JSON.stringify({ path: "docs/guide.html", content: "<h1>Updated guide</h1>" }),
    });
    const updated = await window
      .fetch("/api/note?path=docs%2Fguide.html")
      .then((response) => response.text());
    expect(updated).toContain("Updated guide");

    const thread = await window
      .fetch("/api/agent/threads", { method: "POST" })
      .then((response) => response.json());
    await window.fetch(`/api/agent/threads/${thread.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ prompt: "Help me deploy" }),
    });

    let threads = await window.fetch("/api/agent/threads").then((response) => response.json());
    const request = threads[0].requests[0];
    expect(request.title).toBe("What do you want to know?");

    await window.fetch(`/api/agent/threads/${thread.id}/requests/${request.id}`, {
      method: "POST",
      body: JSON.stringify({ decision: "Deploying" }),
    });
    threads = await window.fetch("/api/agent/threads").then((response) => response.json());
    expect(threads[0].status).toBe("idle");
    expect(threads[0].messages.at(-1).text).toContain("static host");
  });
});
