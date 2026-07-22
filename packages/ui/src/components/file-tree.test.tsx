// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FileTree, type FileTreeActions } from "./file-tree";

type OpenInEditor = (path: string) => Promise<void>;
type TestActions = Omit<FileTreeActions, "openInEditor"> & {
  openInEditor: Mock<OpenInEditor>;
};

function actions(): TestActions {
  const openInEditor = vi.fn<OpenInEditor>(async () => {});
  return {
    open: vi.fn(),
    openInEditor,
    copyPath: vi.fn(async () => {}),
    copyAbsolutePath: vi.fn(async () => {}),
    createNote: vi.fn(),
    createFolder: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(async () => {}),
  };
}

function contextMenuEvent() {
  return new MouseEvent("contextmenu", {
    bubbles: true,
    button: 2,
    clientX: 12,
    clientY: 12,
  });
}

function touchEvent(type: "touchstart" | "touchmove" | "touchend", x = 12, y = 12) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [{ clientX: x, clientY: y }],
  });
  return event;
}

describe("FileTree context menu", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let elementFromPoint: Mock<(x: number, y: number) => Element | null>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    elementFromPoint = vi.fn();
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPoint,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    vi.unstubAllGlobals();
  });

  it("offers opening both notes and folders in the editor", async () => {
    const fileActions = actions();
    await act(async () =>
      root.render(
        <FileTree
          entries={[
            { path: "readme.html", type: "file" },
            { path: "docs/note.html", type: "file" },
          ]}
          actions={fileActions}
        />,
      ),
    );

    const treeItems = [...container.querySelectorAll<HTMLElement>(".nawc-file-tree-item")];
    const readme = treeItems.find((item) => item.textContent?.includes("readme"));
    const docs = treeItems.find((item) => item.textContent?.includes("docs"));
    expect(readme).toBeDefined();
    expect(docs).toBeDefined();

    await act(async () => readme?.dispatchEvent(contextMenuEvent()));
    expect(document.querySelector('[role="menu"]')?.className).toContain("z-50");
    const readmeEditorItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Open in Editor",
    );
    expect(readmeEditorItem).toBeDefined();
    await act(async () => readmeEditorItem?.click());
    expect(fileActions.openInEditor.mock.calls).toContainEqual(["readme.html"]);

    await act(async () => docs?.dispatchEvent(contextMenuEvent()));
    const folderEditorItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Open in Editor",
    );
    expect(folderEditorItem).toBeDefined();
    await act(async () => folderEditorItem?.click());
    expect(fileActions.openInEditor.mock.calls).toContainEqual(["docs"]);
  });

  it("moves a file by long-pressing and dragging it on touch screens", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const fileActions = actions();
    await act(async () =>
      root.render(
        <FileTree
          entries={[
            { path: "readme.html", type: "file" },
            { path: "docs", type: "folder" },
          ]}
          actions={fileActions}
        />,
      ),
    );

    const items = [...container.querySelectorAll<HTMLElement>(".nawc-file-tree-item")];
    const source = items.find((item) => item.textContent?.includes("readme"));
    const destination = items.find((item) => item.textContent?.includes("docs"));
    expect(source).toBeDefined();
    expect(destination).toBeDefined();
    elementFromPoint.mockReturnValue(destination ?? null);

    await act(async () => source?.dispatchEvent(touchEvent("touchstart")));
    await act(async () => vi.advanceTimersByTime(450));
    expect(source?.classList.contains("dragging")).toBe(true);
    await act(async () => source?.dispatchEvent(touchEvent("touchmove", 30, 60)));
    expect(destination?.classList.contains("drop-target")).toBe(true);
    await act(async () => source?.dispatchEvent(touchEvent("touchend")));

    expect(fileActions.move).toHaveBeenCalledWith(
      expect.objectContaining({ path: "readme.html", type: "file" }),
      "docs",
    );
    expect(fileActions.open).not.toHaveBeenCalled();
  });
});
