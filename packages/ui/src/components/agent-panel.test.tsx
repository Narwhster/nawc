// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentPanel, CompletionMenu } from "./agent-panel";

const emptyThread = {
  id: "thread-1",
  provider: "test",
  updatedAt: "2026-07-12T00:00:00.000Z",
  status: "idle",
  turns: [],
  messages: [],
  activities: [],
  requests: [],
  warnings: [],
} as const;

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

describe("CompletionMenu", () => {
  let container: HTMLDivElement;
  let anchor: HTMLTextAreaElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    anchor = document.createElement("textarea");
    container.append(anchor);
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("portals every completion kind outside an overflow-constrained composer", async () => {
    const choose = vi.fn();
    await act(async () =>
      root.render(
        <CompletionMenu
          anchor={anchor}
          activeCompletion={0}
          completions={[
            { kind: "file", value: "src/index.ts", detail: "file" },
            { kind: "skill", value: "review", detail: "Review changes" },
            { kind: "command", value: "model", detail: "Choose a model" },
            { kind: "model", value: "gpt", detail: "GPT" },
            { kind: "reasoning", value: "high", detail: "Deep reasoning" },
          ]}
          onChoose={choose}
        />,
      ),
    );

    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(listbox?.textContent).toContain("src/index.ts");
    expect(listbox?.textContent).toContain("$review");
    expect(listbox?.textContent).toContain("/model");
    expect(listbox?.textContent).toContain("gpt");
    expect(listbox?.textContent).toContain("high");

    const completion = listbox?.querySelector("button");
    expect(completion).toBeInstanceOf(HTMLButtonElement);
    completion?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(choose).toHaveBeenCalledWith({ kind: "file", value: "src/index.ts", detail: "file" });
  });

  it("keeps a newly created first conversation selected after sending", async () => {
    let threadReads = 0;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/agent/provider")) {
        return Promise.resolve(jsonResponse({ label: "Test agent", capabilities: [], modes: [] }));
      }
      if (url.endsWith("/api/prompt/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/prompt/settings")) return Promise.resolve(jsonResponse({}));
      if (url.endsWith("/api/agent/threads") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(emptyThread));
      }
      if (url.endsWith("/api/agent/threads")) {
        threadReads += 1;
        return Promise.resolve(jsonResponse(threadReads === 1 ? [] : [emptyThread]));
      }
      if (url.endsWith("/api/agent/threads/thread-1/turns")) {
        return Promise.resolve(
          new Response(new ReadableStream({ start: (controller) => controller.close() })),
        );
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentPanel />
        </TooltipProvider>,
      ),
    );
    await act(async () => Promise.resolve());

    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Message the agent"]');
    expect(input).not.toBeNull();
    if (!input) throw new Error("Message input did not render");
    await act(async () => {
      Reflect.set(HTMLTextAreaElement.prototype, "value", "hi", input);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>('[aria-label="Send message"]');
    await act(async () => send?.click());
    await act(async () => Promise.resolve());

    expect(localStorage.getItem("nawc:agent-active-thread:v1")).toBe("thread-1");
    expect(container.querySelector('[aria-label="Conversation"]')).not.toBeNull();
  });
});
