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

function touchPointerEvent(type: "pointerdown" | "pointerup") {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    clientX: { value: 12 },
    clientY: { value: 12 },
    pointerType: { value: "touch" },
  });
  return event;
}

function touchEvent(type: "touchstart" | "touchend") {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [{ clientX: 12, clientY: 12 }],
  });
  return event;
}

describe("FileTree context menu", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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

  it("opens the context menu after a touch hold", async () => {
    vi.useFakeTimers();
    const fileActions = actions();
    await act(async () =>
      root.render(
        <FileTree entries={[{ path: "readme.html", type: "file" }]} actions={fileActions} />,
      ),
    );
    const item = container.querySelector<HTMLElement>(".nawc-file-tree-item");
    expect(item).not.toBeNull();

    await act(async () => item?.dispatchEvent(touchPointerEvent("pointerdown")));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(700));

    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => item?.dispatchEvent(touchPointerEvent("pointerup")));
  });

  it("opens the context menu through touch events on WebKit", async () => {
    vi.useFakeTimers();
    const fileActions = actions();
    await act(async () =>
      root.render(
        <FileTree entries={[{ path: "readme.html", type: "file" }]} actions={fileActions} />,
      ),
    );
    const item = container.querySelector<HTMLElement>(".nawc-file-tree-item");
    expect(item).not.toBeNull();

    await act(async () => item?.dispatchEvent(touchEvent("touchstart")));
    await act(async () => vi.advanceTimersByTime(700));

    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => item?.dispatchEvent(touchEvent("touchend")));
    await act(async () => item?.click());
    expect(fileActions.open).not.toHaveBeenCalled();
  });
});
