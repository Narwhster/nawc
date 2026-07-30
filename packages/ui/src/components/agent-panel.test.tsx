// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@nawcui/components/ui/tooltip";
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
    anchor = document.createElement("textarea");
    container.append(anchor);
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
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

  it("keeps model completions stable when models have no reasoning metadata", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/agent/provider")) {
        return Promise.resolve(jsonResponse({ label: "Test agent", capabilities: [], modes: [] }));
      }
      if (url.endsWith("/api/prompt/models")) {
        return Promise.resolve(
          jsonResponse([
            { id: "opencode/gpt-5", name: "GPT-5" },
            { id: "opencode/claude-sonnet-4", name: "Claude Sonnet 4" },
          ]),
        );
      }
      if (url.endsWith("/api/prompt/settings")) return Promise.resolve(jsonResponse({}));
      if (url.endsWith("/api/agent/threads")) return Promise.resolve(jsonResponse([]));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentPanel />
        </TooltipProvider>,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Message the agent"]');
    expect(input).not.toBeNull();
    if (!input) throw new Error("Message input did not render");
    await act(async () => {
      Reflect.set(HTMLTextAreaElement.prototype, "value", "/model", input);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => Promise.resolve());

    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox?.textContent).toContain("opencode/gpt-5");
    expect(listbox?.textContent).toContain("opencode/claude-sonnet-4");
  });

  it("applies live thread snapshots while a turn is running", async () => {
    const runningThread = {
      ...emptyThread,
      status: "running" as const,
      messages: [
        {
          id: "message-1",
          role: "user" as const,
          text: "Think about this",
          turnId: "turn-1",
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
          streaming: false,
        },
      ],
      turns: [{ id: "turn-1", status: "running" as const }],
    };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/agent/provider")) {
        return Promise.resolve(jsonResponse({ label: "Test agent", capabilities: [], modes: [] }));
      }
      if (url.endsWith("/api/prompt/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/prompt/settings")) return Promise.resolve(jsonResponse({}));
      if (url.endsWith("/api/agent/threads")) return Promise.resolve(jsonResponse([runningThread]));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("nawc:agent-active-thread:v1", runningThread.id);

    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentPanel />
        </TooltipProvider>,
      ),
    );
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("Thinking…");
    const completedThread = {
      ...runningThread,
      status: "idle" as const,
      turns: [{ id: "turn-1", status: "completed" as const }],
      messages: [
        ...runningThread.messages,
        {
          id: "assistant-1",
          role: "assistant" as const,
          text: "Finished without a refresh",
          turnId: "turn-1",
          createdAt: "2026-07-12T00:00:01.000Z",
          updatedAt: "2026-07-12T00:00:01.000Z",
          streaming: false,
        },
      ],
    };
    window.dispatchEvent(
      new CustomEvent("nawc:agent-changed", {
        detail: { threadId: runningThread.id, thread: completedThread },
      }),
    );
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("Finished without a refresh");
  });

  it("resynchronizes threads after the agent event stream reconnects", async () => {
    const reconnectedThread = {
      ...emptyThread,
      messages: [
        {
          id: "assistant-1",
          role: "assistant" as const,
          text: "Recovered after reconnect",
          turnId: "turn-1",
          createdAt: "2026-07-12T00:00:01.000Z",
          updatedAt: "2026-07-12T00:00:01.000Z",
          streaming: false,
        },
      ],
    };
    let threadReads = 0;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/agent/provider")) {
        return Promise.resolve(jsonResponse({ label: "Test agent", capabilities: [], modes: [] }));
      }
      if (url.endsWith("/api/prompt/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/prompt/settings")) return Promise.resolve(jsonResponse({}));
      if (url.endsWith("/api/agent/threads")) {
        threadReads += 1;
        return Promise.resolve(
          jsonResponse(threadReads === 1 ? [emptyThread] : [reconnectedThread]),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("nawc:agent-active-thread:v1", reconnectedThread.id);

    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentPanel />
        </TooltipProvider>,
      ),
    );
    await act(async () => Promise.resolve());
    expect(threadReads).toBe(1);

    window.dispatchEvent(new CustomEvent("nawc:agent-events-reconnected"));
    await act(async () => Promise.resolve());

    expect(threadReads).toBe(2);
    expect(container.textContent).toContain("Recovered after reconnect");
  });

  it("renders a turn-level permission request only once", async () => {
    const requestedThread = {
      ...emptyThread,
      status: "running" as const,
      messages: [
        {
          id: "user-message",
          role: "user" as const,
          text: "Edit the file",
          turnId: "turn-1",
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
          streaming: false,
        },
        {
          id: "assistant-message",
          role: "assistant" as const,
          text: "I need permission.",
          turnId: "turn-1",
          createdAt: "2026-07-12T00:00:01.000Z",
          updatedAt: "2026-07-12T00:00:01.000Z",
          streaming: true,
        },
      ],
      turns: [{ id: "turn-1", status: "running" as const }],
      requests: [
        {
          id: "permission-1",
          turnId: "turn-1",
          kind: "permission",
          title: "Write file",
          status: "pending" as const,
        },
      ],
    };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/agent/provider")) {
        return Promise.resolve(jsonResponse({ label: "Test agent", capabilities: [], modes: [] }));
      }
      if (url.endsWith("/api/prompt/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/prompt/settings")) return Promise.resolve(jsonResponse({}));
      if (url.endsWith("/api/agent/threads"))
        return Promise.resolve(jsonResponse([requestedThread]));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("nawc:agent-active-thread:v1", requestedThread.id);

    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentPanel />
        </TooltipProvider>,
      ),
    );
    await act(async () => Promise.resolve());

    expect(container.querySelectorAll("[role=alert]")).toHaveLength(1);
    expect(
      [...container.querySelectorAll("button")].filter(
        (button) => button.textContent === "Allow once",
      ),
    ).toHaveLength(1);
  });

  it("renders a permission request when the latest assistant message is empty", async () => {
    const requestedThread = {
      ...emptyThread,
      status: "running" as const,
      messages: [
        {
          id: "user-message",
          role: "user" as const,
          text: "Read an external file",
          turnId: "turn-1",
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
          streaming: false,
        },
        {
          id: "assistant-message",
          role: "assistant" as const,
          text: "",
          turnId: "turn-1",
          createdAt: "2026-07-12T00:00:01.000Z",
          updatedAt: "2026-07-12T00:00:01.000Z",
          streaming: false,
        },
      ],
      turns: [{ id: "turn-1", status: "running" as const }],
      requests: [
        {
          id: "permission-1",
          turnId: "turn-1",
          kind: "permission",
          title: "Allow OpenCode to use external directory",
          details: "/home/user/dev/other/*",
          status: "pending" as const,
        },
      ],
    };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/agent/provider")) {
        return Promise.resolve(jsonResponse({ label: "Test agent", capabilities: [], modes: [] }));
      }
      if (url.endsWith("/api/prompt/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/prompt/settings")) return Promise.resolve(jsonResponse({}));
      if (url.endsWith("/api/agent/threads"))
        return Promise.resolve(jsonResponse([requestedThread]));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("nawc:agent-active-thread:v1", requestedThread.id);

    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentPanel />
        </TooltipProvider>,
      ),
    );
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("Allow OpenCode to use external directory");
    expect(container.textContent).toContain("/home/user/dev/other/*");
    expect(
      [...container.querySelectorAll("button")].filter(
        (button) => button.textContent === "Allow once",
      ),
    ).toHaveLength(1);
  });

  it("renders provider choice labels and sends their opaque IDs", async () => {
    const questionThread = {
      ...emptyThread,
      status: "running" as const,
      messages: [
        {
          id: "message-1",
          role: "assistant" as const,
          text: "One question.",
          turnId: "turn-1",
          createdAt: "2026-07-12T00:00:01.000Z",
          streaming: true,
        },
      ],
      turns: [{ id: "turn-1", status: "running" as const }],
      requests: [
        {
          id: "question-1",
          turnId: "turn-1",
          kind: "cursor/ask_question",
          title: "Choose a framework",
          details: "Which framework should I use?",
          choices: [
            { id: "react-option", label: "React" },
            { id: "vue-option", label: "Vue" },
          ],
          allowCustom: true,
          status: "pending" as const,
        },
      ],
    };
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/agent/provider")) {
        return Promise.resolve(jsonResponse({ label: "Test agent", capabilities: [], modes: [] }));
      }
      if (url.endsWith("/api/prompt/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/prompt/settings")) return Promise.resolve(jsonResponse({}));
      if (url.endsWith("/api/agent/threads")) {
        return Promise.resolve(jsonResponse([questionThread]));
      }
      if (url.endsWith("/api/agent/threads/thread-1/requests/question-1")) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("nawc:agent-active-thread:v1", questionThread.id);

    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentPanel />
        </TooltipProvider>,
      ),
    );
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("Which framework should I use?");
    expect(container.querySelector('[aria-label="Custom answer"]')).not.toBeNull();
    const react = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "React",
    );
    await act(async () => react?.click());

    const response = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.endsWith("/api/agent/threads/thread-1/requests/question-1");
    });
    expect(response?.[1]?.body).toBe(JSON.stringify({ decision: "react-option" }));
  });

  it("clears the local running state after interrupting an in-flight turn", async () => {
    let interrupted = false;
    let interruptCalled = false;
    let closeTurn: (() => void) | undefined;
    const runningThread = { ...emptyThread, status: "running" as const };
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
      if (url.endsWith("/api/agent/threads/thread-1/interrupt")) {
        interruptCalled = true;
        interrupted = true;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.endsWith("/api/agent/threads/thread-1/turns")) {
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                closeTurn = () => controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
        );
      }
      if (url.endsWith("/api/agent/threads")) {
        return Promise.resolve(jsonResponse(interrupted ? [emptyThread] : [runningThread]));
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
    if (!input) throw new Error("Message input did not render");
    await act(async () => {
      Reflect.set(HTMLTextAreaElement.prototype, "value", "keep working", input);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

    const stop = container.querySelector<HTMLButtonElement>('[aria-label="Stop agent"]');
    expect(stop).not.toBeNull();
    await act(async () => stop?.click());
    window.dispatchEvent(
      new CustomEvent("nawc:agent-changed", {
        detail: { threadId: "thread-1", thread: { ...runningThread, status: "idle" as const } },
      }),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(container.querySelector('[aria-label="Send message"]')).not.toBeNull();
    expect(interruptCalled).toBe(true);
    closeTurn?.();
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

    expect(window.localStorage.getItem("nawc:agent-active-thread:v1")).toBe("thread-1");
    expect(container.querySelector('[aria-label="Conversation"]')).not.toBeNull();
    expect(threadReads).toBe(1);
  });

  it("preserves an unsent draft when the active note changes", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/agent/provider")) {
        return Promise.resolve(jsonResponse({ label: "Test agent", capabilities: [], modes: [] }));
      }
      if (url.endsWith("/api/prompt/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/prompt/settings")) return Promise.resolve(jsonResponse({}));
      if (url.endsWith("/api/agent/threads")) return Promise.resolve(jsonResponse([]));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentPanel note="first.html" />
        </TooltipProvider>,
      ),
    );
    await act(async () => Promise.resolve());

    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Message the agent"]');
    if (!input) throw new Error("Message input did not render");
    await act(async () => {
      Reflect.set(HTMLTextAreaElement.prototype, "value", "keep this draft", input);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentPanel note="second.html" />
        </TooltipProvider>,
      ),
    );

    expect(
      container.querySelector<HTMLTextAreaElement>('[aria-label="Message the agent"]')?.value,
    ).toBe("keep this draft");
  });
});
