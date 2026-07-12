import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { EditorAction } from "@nawc/ui/components/editor-action";
import { TooltipProvider } from "@nawc/ui/components/ui/tooltip";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export function editorPresentation(icon: string) {
  return { "data-editor-icon": icon };
}

it("renders a configured non-VS-Code editor icon", async () => {
  const originalFetch = globalThis.fetch;
  const container = document.createElement("div");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ editor: { name: "zed", label: "Zed", icon: "zed" } }), {
      headers: { "content-type": "application/json" },
    });
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(EditorAction, { file: "README.md", scope: "source" }),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector("svg")?.getAttribute("data-editor-icon")).toBe("zed");
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
  }
});
