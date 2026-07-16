import type {
  DockviewApi,
  DockviewReadyEvent,
  DockviewTheme,
  IDockviewPanel,
  IDockviewPanelProps,
} from "dockview-react";
import { createId } from "@paralleldrive/cuid2";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { DockviewReact } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FilePlus2Icon,
  FolderPlusIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster } from "@/components/ui/sonner";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DocumentPane } from "@/components/document-pane";
import { FileTree, type FileTreeActions } from "@/components/file-tree";
import { AgentPanel } from "@/components/agent-panel";
import { WorkspaceDialog, type WorkspaceDialogState } from "@/components/workspace-dialog";
import { EditorAction } from "@/components/editor-action";
import { NoteSearchDialog } from "@/components/note-search";
import { api, json } from "@/lib/api";
import {
  createNoteHistory,
  navigateHistory,
  peekHistory,
  recordNavigation,
  type NoteHistory,
} from "@/lib/note-history";
import { parseNoteLink } from "@/lib/note-link";
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

const mobileMediaQuery = "(max-width: 767px)";

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
  const sidebarPanel = useRef<PanelImperativeHandle | null>(null);
  const agentPanel = useRef<PanelImperativeHandle | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(mobileMediaQuery).matches);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [active, setActive] = useState<string>();
  const [navigation, setNavigation] = useState<NavigationState>({
    canGoBack: false,
    canGoForward: false,
  });
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !window.matchMedia(mobileMediaQuery).matches,
  );
  const [agentOpen, setAgentOpen] = useState(() => !window.matchMedia(mobileMediaQuery).matches);
  const [dialog, setDialog] = useState<WorkspaceDialogState>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  const [srcDir, setSrcDir] = useState<string>("");

  useEffect(() => {
    const media = window.matchMedia(mobileMediaQuery);
    const onChange = () => {
      setIsMobile(media.matches);
      setSidebarOpen(!media.matches);
      setAgentOpen(!media.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (sidebarOpen) sidebarPanel.current?.expand();
    else sidebarPanel.current?.collapse();
  }, [sidebarOpen]);

  useEffect(() => {
    if (agentOpen) agentPanel.current?.expand();
    else agentPanel.current?.collapse();
  }, [agentOpen]);

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
      void (async () => {
        const dock = dockview.current;
        if (!dock) return;
        try {
          const notes = await api<string[]>("/api/notes");
          if (!notes.includes(path)) {
            toast.error(`Note not found: ${displayName(path)}`);
            return;
          }
        } catch {
          toast.error(`Note not found: ${displayName(path)}`);
          return;
        }
        if (!newPanel && dock.activePanel) {
          const panel = dock.activePanel;
          const currentPath = panelPath(panel);
          if (currentPath)
            recordNavigation(getNoteHistory(noteHistories.current, panel), currentPath, path);
          panel.api.setTitle(displayName(path));
          panel.api.updateParameters({ path });
          panel.api.setActive();
          setActive(path);
          if (isMobile) setSidebarOpen(false);
          updateNavigation(panel);
          return;
        }
        const panel = dock.addPanel({
          id: `${path}:${createId()}`,
          component: "note",
          title: displayName(path),
          params: { path },
        });
        noteHistories.current.set(panel.id, createNoteHistory());
        if (isMobile) setSidebarOpen(false);
        updateNavigation(panel);
      })();
    },
    [isMobile, updateNavigation],
  );

  const openNoteRef = useRef(openNote);
  openNoteRef.current = openNote;

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
      setActive(path);
      updateNavigation(panel);
    },
    [openNote, updateNavigation],
  );

  useEffect(() => {
    void refresh();
    void api<{ srcDir: string }>("/api/meta").then((meta) => setSrcDir(meta.srcDir));
    const events = new EventSource("/api/events");
    events.onmessage = (message) => {
      const detail = JSON.parse(message.data) as { event: string; file?: string };
      if (detail.event !== "ready") void refresh();
      if (detail.event !== "ready") setSearchRevision((revision) => revision + 1);
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

  useEffect(() => {
    const openAgent = () => setAgentOpen(true);
    window.addEventListener("nawc:open-agent", openAgent);
    return () => window.removeEventListener("nawc:open-agent", openAgent);
  }, []);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  const actions: FileTreeActions = {
    open: openNote,
    copyPath: async (path) => {
      await navigator.clipboard.writeText(`src/${path}`);
      toast.success("Path copied");
    },
    copyAbsolutePath: async (path) => {
      await navigator.clipboard.writeText(`${srcDir}/${path}`);
      toast.success("Absolute path copied");
    },
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
      if (panel === dockview.current?.activePanel) setActive(nextPath);
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

  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      const next = !open;
      if (isMobile && next) setAgentOpen(false);
      return next;
    });
  };

  const toggleAgent = () => {
    setAgentOpen((open) => {
      const next = !open;
      if (isMobile && next) setSidebarOpen(false);
      return next;
    });
  };

  const sidebar = (
    <aside className="nawc-sidebar">
      <header>
        <Button className="nawc-search-trigger" variant="ghost" onClick={() => setSearchOpen(true)}>
          <SearchIcon />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </Button>
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
  );

  const workspace = (
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
          const path = parseNoteLink(window.location.href);
          if (path) openNoteRef.current(path, true);
        }}
      />
    </section>
  );

  return (
    <TooltipProvider>
      <Toaster />
      <main className="nawc-app">
        <header className="nawc-topbar">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={toggleSidebar}>
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
                onClick={toggleAgent}
              >
                <SparklesIcon />
                <span className="sr-only">Toggle agent</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle agent</TooltipContent>
          </Tooltip>
        </header>
        {isMobile ? (
          <div className="nawc-mobile-content">
            {workspace}
            {sidebarOpen && (
              <div className="nawc-mobile-drawer nawc-mobile-files">
                <Button
                  aria-label="Close files"
                  className="nawc-mobile-drawer-close"
                  size="icon-sm"
                  variant="secondary"
                  onClick={toggleSidebar}
                >
                  <XIcon />
                </Button>
                {sidebar}
              </div>
            )}
            {agentOpen && (
              <div className="nawc-mobile-drawer nawc-mobile-agent">
                <Button
                  aria-label="Close agent"
                  className="nawc-mobile-drawer-close"
                  size="icon-sm"
                  variant="secondary"
                  onClick={toggleAgent}
                >
                  <XIcon />
                </Button>
                <AgentPanel note={active} />
              </div>
            )}
          </div>
        ) : (
          <ResizablePanelGroup
            className="nawc-panel-group"
            id="nawc-panels"
            orientation="horizontal"
          >
            <ResizablePanel
              id="files"
              className="nawc-resizable-panel"
              style={{ overflow: "hidden" }}
              defaultSize="20rem"
              collapsible
              panelRef={sidebarPanel}
            >
              {sidebar}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              id="workspace"
              className="nawc-resizable-panel"
              style={{ overflow: "hidden" }}
            >
              {workspace}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              id="agent"
              className="nawc-resizable-panel"
              style={{ overflow: "hidden" }}
              defaultSize="36rem"
              collapsible
              panelRef={agentPanel}
            >
              <AgentPanel note={active} />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
        <WorkspaceDialog
          state={dialog}
          onOpenChange={(open) => {
            if (!open) setDialog(undefined);
          }}
          onSubmit={(value) => void submitDialog(value)}
        />
        <NoteSearchDialog
          open={searchOpen}
          revision={searchRevision}
          onOpenChange={setSearchOpen}
          onOpenNote={openNote}
        />
      </main>
    </TooltipProvider>
  );
}
