import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Button } from "@nawc/ui/components/ui/button";
import { EditorAction } from "@nawc/ui/components/editor-action";
import { SparklesIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NawcClientPlugin } from "@nawc/plugin";

function ReactInteractiveView({ node, deleteNode }: NodeViewProps) {
  const file = String(node.attrs.file ?? "");
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((current) => current + 1);
    window.addEventListener("nawc:files-changed", refresh);
    return () => window.removeEventListener("nawc:files-changed", refresh);
  }, []);
  useEffect(() => {
    const resize = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data as { type?: unknown; height?: unknown };
      if (
        message?.type === "nawc:interactive-resize" &&
        typeof message.height === "number" &&
        Number.isFinite(message.height)
      )
        setHeight(Math.max(256, Math.min(768, message.height)));
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, []);
  const preview = useMemo(() => {
    const url = new URL("/@nawc/react-interactive", window.location.href);
    url.searchParams.set("file", file);
    url.searchParams.set("revision", String(revision));
    return url.toString();
  }, [file, revision]);
  return (
    <NodeViewWrapper className="nawc-node-shell">
      <iframe
        ref={frame}
        className="nawc-interactive-frame"
        sandbox="allow-scripts"
        src={preview}
        style={{ height }}
        title={`React interactive: ${file}`}
      />
      <div className="nawc-node-ribbon" contentEditable={false}>
        <EditorAction file={file} line={1} scope="source" side="right" />
        <Button
          aria-label="Ask the agent"
          size="icon-sm"
          variant="ghost"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("nawc:prompt", {
                detail: `Update this react-interactive block (${JSON.stringify({ file })}): `,
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

export const ReactInteractive = Node.create({
  name: "react-interactive",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { file: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "react-interactive" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "react-interactive",
      mergeAttributes(HTMLAttributes, { "data-nawc-node": "react-interactive" }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ReactInteractiveView);
  },
});

const plugin: NawcClientPlugin = { name: "react", extensions: [ReactInteractive] };
export default plugin;
