// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@nawcui/components/ui/tooltip";
import { AgentPanel } from "./agent-panel";

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

describe("error ordering", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return values.size;
        },
        clear: () => {
          values.clear();
        },
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        removeItem: (key: string) => {
          values.delete(key);
        },
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      } satisfies Storage,
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders error alerts above subsequent user messages, not stuck at the bottom", async () => {
    const threadWithWarning = {
      ...emptyThread,
      turns: [
        {
          id: "turn-1",
          status: "failed" as const,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
        {
          id: "turn-2",
          status: "running" as const,
          createdAt: "2026-07-12T00:00:02.000Z",
          updatedAt: "2026-07-12T00:00:02.000Z",
        },
      ],
      messages: [
        {
          id: "user-1",
          role: "user" as const,
          text: "First message that triggers an error",
          turnId: "turn-1",
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
          streaming: false,
        },
        {
          id: "user-2",
          role: "user" as const,
          text: "Second message after the error",
          turnId: "turn-2",
          createdAt: "2026-07-12T00:00:02.000Z",
          updatedAt: "2026-07-12T00:00:02.000Z",
          streaming: false,
        },
      ],
      warnings: [{ message: "Agent run was interrupted", turnId: "turn-1" }],
    };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/agent/provider")) {
        return Promise.resolve(jsonResponse({ label: "Test agent", capabilities: [], modes: [] }));
      }
      if (url.endsWith("/api/prompt/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/prompt/settings")) return Promise.resolve(jsonResponse({}));
      if (url.endsWith("/api/agent/threads")) {
        return Promise.resolve(jsonResponse([threadWithWarning]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("nawc:agent-active-thread:v1", "thread-1");

    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentPanel />
        </TooltipProvider>,
      ),
    );
    await act(async () => Promise.resolve());

    const errorAlert = container.querySelector('[role="alert"]');
    const allUserMessages = container.querySelectorAll('[data-slot="message"][data-role="user"]');
    const secondMessage = allUserMessages[1]; // the "Second message after the error"

    expect(errorAlert).not.toBeNull();
    expect(secondMessage).not.toBeNull();

    if (errorAlert && secondMessage) {
      // Error from turn-1 must appear BEFORE the turn-2 user message in the DOM,
      // not stuck at the bottom after it.
      expect(errorAlert.compareDocumentPosition(secondMessage)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });
});
