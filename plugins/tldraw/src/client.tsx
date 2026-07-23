import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Button } from "@nawc/ui/components/ui/button";
import { EditorAction } from "@nawc/ui/components/editor-action";
import { SparklesIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NawcClientPlugin } from "@nawc/plugin";
import { shouldRefreshTldraw, type FileChange } from "./refresh.ts";

function TldrawCanvasView({ node, deleteNode }: NodeViewProps) {
  const file = String(node.attrs.file ?? "");
  const script = String(node.attrs.script ?? "");
  const frame = useRef<HTMLIFrameElement>(null);
  const pendingSnapshotSaves = useRef(0);
  const suppressSnapshotRefreshUntil = useRef(0);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = (event: Event) => {
      const change = (event as CustomEvent<FileChange>).detail;
      if (
        shouldRefreshTldraw(
          change,
          { snapshot: file, script },
          Date.now() <= suppressSnapshotRefreshUntil.current,
        )
      )
        setRevision((value) => value + 1);
    };
    window.addEventListener("nawc:files-changed", refresh);
    return () => window.removeEventListener("nawc:files-changed", refresh);
  }, [file, script]);
  const preview = useMemo(() => {
    const url = new URL("/@nawc/tldraw", window.location.href);
    url.searchParams.set("file", file);
    if (script) url.searchParams.set("script", script);
    url.searchParams.set("revision", String(revision));
    return url.toString();
  }, [file, script, revision]);
  useEffect(() => {
    const save = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "nawc:tldraw-save")
        return;
      pendingSnapshotSaves.current += 1;
      suppressSnapshotRefreshUntil.current = Number.POSITIVE_INFINITY;
      try {
        await fetch(preview, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event.data.snapshot),
        });
      } finally {
        pendingSnapshotSaves.current -= 1;
        if (pendingSnapshotSaves.current === 0)
          suppressSnapshotRefreshUntil.current = Date.now() + 1_000;
      }
    };
    window.addEventListener("message", save);
    return () => window.removeEventListener("message", save);
  }, [preview]);
  return (
    <NodeViewWrapper className="nawc-node-shell">
      <iframe
        ref={frame}
        className="nawc-interactive-frame"
        sandbox="allow-scripts"
        src={preview}
        style={{ height: 560 }}
        title={`tldraw canvas: ${file}`}
      />
      <div className="nawc-node-ribbon" contentEditable={false}>
        <EditorAction file={script || file} line={1} scope="source" side="right" />
        <Button
          aria-label="Ask the agent"
          size="icon-sm"
          variant="ghost"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("nawc:prompt", {
                detail: `Update this tldraw-canvas block (${JSON.stringify({ file, script: script || undefined })}): `,
              }),
            )
          }
        >
          <SparklesIcon />
        </Button>
        <Button aria-label="Delete" size="icon-sm" variant="ghost" onClick={deleteNode}>
          <Trash2Icon />
        </Button>
      </div>
    </NodeViewWrapper>
  );
}

export const TldrawCanvas = Node.create({
  name: "tldraw-canvas",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { file: { default: "" }, script: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "tldraw-canvas" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "tldraw-canvas",
      mergeAttributes(HTMLAttributes, { "data-nawc-node": "tldraw-canvas" }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TldrawCanvasView);
  },
});

const plugin: NawcClientPlugin = { name: "tldraw", extensions: [TldrawCanvas] };
export default plugin;
