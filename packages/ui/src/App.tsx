import type {
  DockviewApi,
  DockviewReadyEvent,
  DockviewTheme,
  IDockviewPanel,
  IDockviewPanelProps,
} from "dockview-react";
import { DockviewReact } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FilePlus2Icon,
  FolderPlusIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DocumentPane } from "@/components/document-pane";
import { FileTree, type FileTreeActions } from "@/components/file-tree";
import { PromptPanel } from "@/components/prompt-panel";
import { WorkspaceDialog, type WorkspaceDialogState } from "@/components/workspace-dialog";
import { EditorAction } from "@/components/editor-action";
import { api, json } from "@/lib/api";
import {
  createNoteHistory,
  navigateHistory,
  peekHistory,
  recordNavigation,
  type NoteHistory,
} from "@/lib/note-history";
import { dirname, displayName, type WorkspaceEntry } from "@/lib/workspace";

const panels = { note: DocumentPane as React.FunctionComponent<IDockviewPanelProps> };
const theme: DockviewTheme = {
  name: "nawc",
  className: "dockview-theme-nawc",
  dndOverlayMounting: "absolute",
  dndPanelOverlay: "group",
  dndTabIndicator: "line",
  tabAnimation: "smooth",
};

type NavigationState = {
  canGoBack: boolean;
  canGoForward: boolean;
};

function panelPath(panel?: IDockviewPanel): string | undefined {
  return (panel?.params as { path?: string } | undefined)?.path;
}

function getNoteHistory(histories: Map<string, NoteHistory>, panel: IDockviewPanel): NoteHistory {
  let history = histories.get(panel.id);
  if (!history) {
    history = createNoteHistory();
    histories.set(panel.id, history);
  }
  return history;
}

export default function App() {
  const dockview = useRef<DockviewApi>(undefined);
  const noteHistories = useRef(new Map<string, NoteHistory>());
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [active, setActive] = useState<string>();
  const [navigation, setNavigation] = useState<NavigationState>({
    canGoBack: false,
    canGoForward: false,
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [agentOpen, setAgentOpen] = useState(true);
  const [dialog, setDialog] = useState<WorkspaceDialogState>();

  const refresh = useCallback(
    async () => setEntries(await api<WorkspaceEntry[]>("/api/files")),
    [],
  );

  const updateNavigation = useCallback((panel?: IDockviewPanel) => {
    const history = panel ? noteHistories.current.get(panel.id) : undefined;
    setNavigation({
      canGoBack: Boolean(history?.back.length),
      canGoForward: Boolean(history?.forward.length),
    });
  }, []);

  const openNote = useCallback(
    (path: string, newPanel = false) => {
      const dock = dockview.current;
      if (!dock) return;
      if (!newPanel && dock.activePanel) {
        const panel = dock.activePanel;
        const currentPath = panelPath(panel);
        if (currentPath)
          recordNavigation(getNoteHistory(noteHistories.current, panel), currentPath, path);
        panel.api.setTitle(displayName(path));
        panel.api.updateParameters({ path });
        panel.api.setActive();
        updateNavigation(panel);
        return;
      }
      const panel = dock.addPanel({
        id: `${path}:${crypto.randomUUID()}`,
        component: "note",
        title: displayName(path),
        params: { path },
      });
      noteHistories.current.set(panel.id, createNoteHistory());
      updateNavigation(panel);
    },
    [updateNavigation],
  );

  const navigateActivePanel = useCallback(
    (direction: "back" | "forward", newPanel = false) => {
      const panel = dockview.current?.activePanel;
      const currentPath = panelPath(panel);
      const history = panel ? noteHistories.current.get(panel.id) : undefined;
      if (!panel || !currentPath || !history) return;
      if (newPanel) {
        const path = peekHistory(history, direction);
        if (path) openNote(path, true);
        return;
      }
      const path = navigateHistory(history, currentPath, direction);
      if (!path) return;
      panel.api.setTitle(displayName(path));
      panel.api.updateParameters({ path });
      panel.api.setActive();
      updateNavigation(panel);
    },
    [openNote, updateNavigation],
  );

  useEffect(() => {
    void refresh();
    const events = new EventSource("/api/events");
    events.onmessage = (message) => {
      const detail = JSON.parse(message.data) as { event: string; file?: string };
      if (detail.event !== "ready") void refresh();
      window.dispatchEvent(new CustomEvent("nawc:files-changed", { detail }));
    };
    return () => events.close();
  }, [refresh]);

  useEffect(() => {
    const onOpenNote = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; newPanel?: boolean } | string>).detail;
      if (typeof detail === "string") openNote(detail);
      else openNote(detail.path, detail.newPanel);
    };
    window.addEventListener("nawc:open-note", onOpenNote);
    return () => window.removeEventListener("nawc:open-note", onOpenNote);
  }, [openNote]);

  const actions: FileTreeActions = {
    open: openNote,
    createNote: (parent = "") => setDialog({ kind: "create-note", parent }),
    createFolder: (parent = "") => setDialog({ kind: "create-folder", parent }),
    rename: (entry) => setDialog({ kind: "rename", entry }),
    delete: (entry) => setDialog({ kind: "delete", entry }),
    move: async (entry, parent) => {
      const name = entry.path.split("/").at(-1) ?? entry.path;
      const to = parent ? `${parent}/${name}` : name;
      if (to === entry.path) return;
      try {
        await api("/api/entry/move", json({ from: entry.path, to }));
        updateMovedPanels(entry.path, to);
      } catch (error) {
        if (error instanceof Error && error.message.includes("already exists")) {
          setDialog({ kind: "replace", entry, to });
          return;
        }
        throw error;
      }
      await refresh();
    },
  };

  const updateMovedPanels = (from: string, to: string) => {
    const updatePath = (path: string) =>
      path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
    for (const history of noteHistories.current.values()) {
      history.back = history.back.map(updatePath);
      history.forward = history.forward.map(updatePath);
    }
    for (const panel of dockview.current?.panels ?? []) {
      const oldPath = (panel.params as { path?: string }).path;
      if (!oldPath || (oldPath !== from && !oldPath.startsWith(`${from}/`))) continue;
      const nextPath = updatePath(oldPath);
      panel.api.setTitle(displayName(nextPath));
      panel.api.updateParameters({ path: nextPath });
    }
    updateNavigation(dockview.current?.activePanel);
  };

  const submitDialog = async (value?: string) => {
    if (!dialog) return;
    if (dialog.kind === "replace") {
      await api("/api/entry/move", json({ from: dialog.entry.path, to: dialog.to, replace: true }));
      updateMovedPanels(dialog.entry.path, dialog.to);
    } else if (dialog.kind === "delete") {
      await api(`/api/entry?path=${encodeURIComponent(dialog.entry.path)}`, { method: "DELETE" });
      for (const panel of dockview.current?.panels ?? []) {
        const path = (panel.params as { path?: string }).path;
        if (path === dialog.entry.path || path?.startsWith(`${dialog.entry.path}/`)) {
          noteHistories.current.delete(panel.id);
          dockview.current?.removePanel(panel);
        }
      }
    } else if (dialog.kind === "rename" && value) {
      const parent = dirname(dialog.entry.path);
      const fileName =
        dialog.entry.type === "file" && !value.endsWith(".html") ? `${value}.html` : value;
      const to = parent ? `${parent}/${fileName}` : fileName;
      await api("/api/entry/rename", json({ from: dialog.entry.path, to }));
      updateMovedPanels(dialog.entry.path, to);
    } else if (dialog.kind === "create-folder" && value) {
      const path = dialog.parent ? `${dialog.parent}/${value}` : value;
      await api("/api/folder", json({ path }));
    } else if (dialog.kind === "create-note" && value) {
      const fileName = value.endsWith(".html") ? value : `${value}.html`;
      const path = dialog.parent ? `${dialog.parent}/${fileName}` : fileName;
      await api(
        "/api/note",
        json({ path, content: `<h1>${displayName(fileName)}</h1><p></p>` }, "PUT"),
      );
      openNote(path, true);
    }
    setDialog(undefined);
    await refresh();
  };

  return (
    <TooltipProvider>
      <main className="nawc-app" data-sidebar-open={sidebarOpen} data-agent-open={agentOpen}>
        <header className="nawc-topbar">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setSidebarOpen((open) => !open)}
              >
                {sidebarOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
                <span className="sr-only">Toggle files</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle files</TooltipContent>
          </Tooltip>
          <span className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={!navigation.canGoBack}
                  onClick={(event) => navigateActivePanel("back", event.metaKey || event.ctrlKey)}
                >
                  <ArrowLeftIcon />
                  <span className="sr-only">Back</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={!navigation.canGoForward}
                  onClick={(event) =>
                    navigateActivePanel("forward", event.metaKey || event.ctrlKey)
                  }
                >
                  <ArrowRightIcon />
                  <span className="sr-only">Forward</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Forward</TooltipContent>
            </Tooltip>
          </span>
          <span className="flex-1" />
          <EditorAction file={active} scope="note" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant={agentOpen ? "secondary" : "ghost"}
                onClick={() => setAgentOpen((open) => !open)}
              >
                <SparklesIcon />
                <span className="sr-only">Toggle agent</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle agent</TooltipContent>
          </Tooltip>
        </header>
        {sidebarOpen && (
          <aside className="nawc-sidebar">
            <header>
              <strong>NAWC</strong>
              <span className="flex gap-1">
                <Button size="icon-sm" variant="ghost" onClick={() => actions.createNote()}>
                  <FilePlus2Icon />
                  <span className="sr-only">New note</span>
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => actions.createFolder()}>
                  <FolderPlusIcon />
                  <span className="sr-only">New folder</span>
                </Button>
              </span>
            </header>
            <Separator />
            <ScrollArea className="min-h-0 flex-1">
              <FileTree entries={entries} active={active} actions={actions} />
            </ScrollArea>
            <Separator />
            <footer>
              <span>src</span>
              <span>{entries.filter((entry) => entry.type === "file").length} notes</span>
            </footer>
          </aside>
        )}
        <section className="nawc-workspace">
          <DockviewReact
            className="h-full w-full"
            theme={theme}
            components={panels}
            onReady={({ api: dock }: DockviewReadyEvent) => {
              dockview.current = dock;
              dock.onDidActivePanelChange((panel) => {
                setActive(panelPath(panel));
                updateNavigation(panel);
              });
            }}
          />
        </section>
        {agentOpen && <PromptPanel note={active} />}
        <WorkspaceDialog
          state={dialog}
          onOpenChange={(open) => {
            if (!open) setDialog(undefined);
          }}
          onSubmit={(value) => void submitDialog(value)}
        />
      </main>
    </TooltipProvider>
  );
}
