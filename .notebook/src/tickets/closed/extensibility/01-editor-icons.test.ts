import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import type { NawcEditorIcon } from "@nawc/config";
import { EditorAction } from "@nawc/ui/components/editor-action";
import { TooltipProvider } from "@nawc/ui/components/ui/tooltip";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const zedIcon: NawcEditorIcon = {
  name: "zed",
  viewBox: "0 0 24 24",
  paths: ["M3 4h18v4L9 16h12v4H3v-4l12-8H3V4Z"],
};

export function editorPresentation(icon: NawcEditorIcon) {
  return { "data-editor-icon": icon.name, viewBox: icon.viewBox, paths: icon.paths };
}

it("renders a configured custom editor icon", async () => {
  const originalFetch = globalThis.fetch;
  const container = document.createElement("div");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ editor: { name: "zed", label: "Zed", icon: zedIcon } }), {
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
    expect(container.querySelector("path")?.getAttribute("d")).toBe(zedIcon.paths[0]);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
  }
});
