import {
  ChevronDownIcon,
  FileIcon,
  FilePlus2Icon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { displayName, type WorkspaceEntry } from "@/lib/workspace";
import { cn } from "@/lib/utils";

type TreeNode = WorkspaceEntry & { name: string; children: TreeNode[] };
type MutableNode = WorkspaceEntry & { name: string; children: Map<string, MutableNode> };

export type FileTreeActions = {
  open(path: string, newPanel?: boolean): void;
  createNote(parent?: string): void;
  createFolder(parent?: string): void;
  rename(entry: WorkspaceEntry): void;
  delete(entry: WorkspaceEntry): void;
  move(entry: WorkspaceEntry, parent: string): Promise<void>;
};

function buildTree(entries: WorkspaceEntry[]): TreeNode[] {
  const root = new Map<string, MutableNode>();
  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let level = root;
    let currentPath = "";
    for (const [index, part] of parts.entries()) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = index === parts.length - 1;
      const type = isLast ? entry.type : "folder";
      let node = level.get(part);
      if (!node) {
        node = {
          path: currentPath,
          type,
          name: type === "file" ? displayName(part) : part,
          children: new Map(),
        };
        level.set(part, node);
      }
      level = node.children;
    }
  }
  const materialize = (nodes: Map<string, MutableNode>): TreeNode[] =>
    [...nodes.values()]
      .sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1,
      )
      .map((node) => ({ ...node, children: materialize(node.children) }));
  return materialize(root);
}

export function FileTree({
  entries,
  active,
  actions,
}: {
  entries: WorkspaceEntry[];
  active?: string;
  actions: FileTreeActions;
}) {
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [dragging, setDragging] = useState<WorkspaceEntry>();
  const [dropTarget, setDropTarget] = useState<string>();
  const tree = useMemo(() => buildTree(entries), [entries]);
  useEffect(() => {
    if (!active) return;
    setExpanded((current) => {
      const next = new Set(current);
      const parts = active.split("/");
      for (let index = 1; index < parts.length; index++) next.add(parts.slice(0, index).join("/"));
      return next;
    });
  }, [active]);
  if (!tree.length) return <p className="nawc-file-tree-empty">No notes yet.</p>;
  return (
    <div
      className={cn("nawc-file-tree", dropTarget === "" && "drop-target")}
      role="tree"
      aria-label="Files"
      onDragOver={(event) => {
        if (!dragging) return;
        event.preventDefault();
        setDropTarget("");
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropTarget(undefined);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDropTarget(undefined);
        if (dragging) void actions.move(dragging, "");
      }}
    >
      {tree.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          active={active}
          expanded={expanded}
          setExpanded={setExpanded}
          dragging={dragging}
          setDragging={setDragging}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
          actions={actions}
        />
      ))}
    </div>
  );
}

function FileTreeItem({
  node,
  active,
  expanded,
  setExpanded,
  dragging,
  setDragging,
  dropTarget,
  setDropTarget,
  actions,
}: {
  node: TreeNode;
  active?: string;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  dragging?: WorkspaceEntry;
  setDragging: React.Dispatch<React.SetStateAction<WorkspaceEntry | undefined>>;
  dropTarget?: string;
  setDropTarget: React.Dispatch<React.SetStateAction<string | undefined>>;
  actions: FileTreeActions;
}) {
  const folder = node.type === "folder";
  const open = expanded.has(node.path);
  const toggle = () =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  return (
    <div role="treeitem" aria-expanded={folder ? open : undefined}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "nawc-file-tree-item",
              node.path === active && "active",
              dropTarget === node.path && "drop-target",
              dragging?.path === node.path && "dragging",
            )}
            style={{ paddingLeft: `${(node.path.split("/").length - 1) * 20}px` }}
            onClick={(event) =>
              folder ? toggle() : actions.open(node.path, event.metaKey || event.ctrlKey)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (folder) toggle();
                else actions.open(node.path, event.metaKey || event.ctrlKey);
              }
            }}
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", node.path);
              setDragging(node);
            }}
            onDragEnd={() => {
              setDragging(undefined);
              setDropTarget(undefined);
            }}
            onDragOver={(event) => {
              if (!folder || !dragging) return;
              if (dragging.path === node.path || node.path.startsWith(`${dragging.path}/`)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              setDropTarget(node.path);
            }}
            onDragLeave={(event) => {
              event.stopPropagation();
              if (dropTarget === node.path) setDropTarget(undefined);
            }}
            onDrop={(event) => {
              if (!folder || !dragging) return;
              event.preventDefault();
              event.stopPropagation();
              setDropTarget(undefined);
              void actions.move(dragging, node.path);
            }}
            role="button"
            tabIndex={0}
          >
            {folder ? (
              <ChevronDownIcon className={`nawc-file-tree-chevron ${open ? "" : "collapsed"}`} />
            ) : (
              <span className="nawc-file-tree-chevron-spacer" />
            )}
            {folder ? (
              open ? (
                <FolderOpenIcon className="nawc-file-tree-folder" />
              ) : (
                <FolderIcon className="nawc-file-tree-folder" />
              )
            ) : (
              <FileIcon className="nawc-file-tree-file" />
            )}
            <span>{node.name}</span>
            {folder && (
              <span className="nawc-tree-actions">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.createNote(node.path);
                  }}
                >
                  <FilePlus2Icon />
                  <span className="sr-only">New note</span>
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.createFolder(node.path);
                  }}
                >
                  <FolderPlusIcon />
                  <span className="sr-only">New folder</span>
                </Button>
              </span>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            {!folder && (
              <>
                <ContextMenuItem onClick={() => actions.open(node.path)}>Open</ContextMenuItem>
                <ContextMenuItem onClick={() => actions.open(node.path, true)}>
                  Open in New Tab
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {folder && (
              <>
                <ContextMenuItem onClick={() => actions.createNote(node.path)}>
                  New Note
                </ContextMenuItem>
                <ContextMenuItem onClick={() => actions.createFolder(node.path)}>
                  New Folder
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem onClick={() => actions.rename(node)}>Rename</ContextMenuItem>
            <ContextMenuItem variant="destructive" onClick={() => actions.delete(node)}>
              Delete
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      {folder && open && (
        <div role="group">
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              active={active}
              expanded={expanded}
              setExpanded={setExpanded}
              dragging={dragging}
              setDragging={setDragging}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              actions={actions}
            />
          ))}
        </div>
      )}
    </div>
  );
}
