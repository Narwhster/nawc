import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Button } from "@nawc/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nawc/ui/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nawc/ui/components/ui/tooltip";
import { ChevronDownIcon, PencilIcon, PlayIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NawcClientPlugin } from "@nawc/plugin";
import { highlightSource } from "./source-highlighting.js";

type SourceAttrs = { file: string; syntax?: string; name?: string; type?: string };
type SourceResult = SourceAttrs & { code: string; startLine: number; endLine: number };

function IconAction({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} size="icon-sm" variant="ghost" {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function Ribbon({
  onDelete,
  onEdit,
  onPrompt,
  onRun,
}: {
  onDelete: () => void;
  onEdit?: () => void;
  onPrompt: () => void;
  onRun?: () => void;
}) {
  return (
    <div className="nawc-node-ribbon" contentEditable={false}>
      {onRun && (
        <IconAction label="Run" onClick={onRun}>
          <PlayIcon />
        </IconAction>
      )}
      {onEdit && (
        <IconAction label="Edit source" onClick={onEdit}>
          <PencilIcon />
        </IconAction>
      )}
      <IconAction label="Ask the agent" onClick={onPrompt}>
        <SparklesIcon />
      </IconAction>
      <IconAction label="Delete" onClick={onDelete}>
        <Trash2Icon />
      </IconAction>
    </div>
  );
}

function promptForNode(kind: string, attrs: Record<string, unknown>) {
  window.dispatchEvent(
    new CustomEvent("nawc:prompt", {
      detail: `Update this ${kind} block (${JSON.stringify(attrs)}): `,
    }),
  );
}

function HighlightedCode({ code, syntax, file }: { code: string; syntax?: string; file?: string }) {
  return (
    <code
      className="nawc-highlighted-code"
      dangerouslySetInnerHTML={{ __html: highlightSource(code, syntax, file) }}
    />
  );
}

function HighlightedTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const codeRef = useRef<HTMLPreElement>(null);

  return (
    <div className="nawc-code-editor">
      <pre ref={codeRef} aria-hidden="true">
        <HighlightedCode code={value} syntax="html" />
      </pre>
      <textarea
        aria-label="Interactive source"
        className="nawc-code-editor-input"
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (!codeRef.current) return;
          codeRef.current.scrollTop = event.currentTarget.scrollTop;
          codeRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        spellCheck={false}
        value={value}
        wrap="off"
      />
    </div>
  );
}

function InteractiveView({ node, deleteNode, updateAttributes }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(String(node.attrs.source ?? ""));
  return (
    <NodeViewWrapper className="nawc-node-shell">
      <iframe
        title="Interactive prototype"
        sandbox="allow-scripts"
        srcDoc={String(node.attrs.source ?? "")}
        className="nawc-interactive-frame"
      />
      <Ribbon
        onDelete={deleteNode}
        onEdit={() => {
          setSource(String(node.attrs.source ?? ""));
          setEditing(true);
        }}
        onPrompt={() => promptForNode("interactive", { source: node.attrs.source })}
      />
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent size="editor" instant>
          <DialogHeader>
            <DialogTitle>Edit source</DialogTitle>
          </DialogHeader>
          <HighlightedTextarea value={source} onChange={setSource} />
          <DialogFooter>
            <Button
              onClick={() => {
                updateAttributes({ source });
                setEditing(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NodeViewWrapper>
  );
}

function SourceView({ node, deleteNode, runnable }: NodeViewProps & { runnable: boolean }) {
  const attrs = node.attrs as SourceAttrs;
  const [source, setSource] = useState<SourceResult>();
  const [error, setError] = useState<string>();
  const [output, setOutput] = useState<string>();
  const load = useCallback(async () => {
    const response = await fetch("/api/source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(attrs),
    });
    const body = (await response.json()) as SourceResult | { error: string };
    if (!response.ok) setError("error" in body ? body.error : "Unable to load source");
    else {
      setSource(body as SourceResult);
      setError(undefined);
    }
  }, [attrs.file, attrs.name, attrs.syntax, attrs.type]);
  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("nawc:files-changed", refresh);
    return () => window.removeEventListener("nawc:files-changed", refresh);
  }, [load]);
  const run = async () => {
    setOutput("Running…");
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(attrs),
    });
    const result = (await response.json()) as { stdout?: string; stderr?: string; error?: string };
    setOutput(
      result.error ??
        ([result.stdout, result.stderr].filter(Boolean).join("\n") || "Completed with no output"),
    );
  };
  return (
    <NodeViewWrapper className="nawc-node-shell">
      <details open className="nawc-source-block">
        <summary>
          <ChevronDownIcon /> <span>{attrs.file}</span>
          {attrs.name && (
            <span className="text-muted-foreground">
              {attrs.type} {attrs.name}
            </span>
          )}
        </summary>
        {error ? (
          <p className="nawc-node-error">{error}</p>
        ) : (
          <pre className="nawc-source-code">
            <HighlightedCode
              code={source?.code ?? "Loading…"}
              file={source?.file ?? attrs.file}
              syntax={source?.syntax ?? attrs.syntax}
            />
          </pre>
        )}
        {output && (
          <pre className="nawc-run-output">
            <code>{output}</code>
          </pre>
        )}
      </details>
      <Ribbon
        onDelete={deleteNode}
        onPrompt={() => promptForNode(runnable ? "runnable" : "ref", attrs)}
        onRun={runnable ? () => void run() : undefined}
      />
    </NodeViewWrapper>
  );
}

const sourceAttributes = {
  file: { default: "" },
  syntax: { default: undefined },
  name: { default: undefined },
  type: { default: undefined },
};

export const Interactive = Node.create({
  name: "interactive",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { source: { default: "", parseHTML: (element) => element.innerHTML } };
  },
  parseHTML() {
    return [{ tag: "interactive" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "interactive",
      mergeAttributes(HTMLAttributes, {
        "data-nawc-node": "interactive",
        "data-nawc-source": HTMLAttributes.source,
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(InteractiveView);
  },
});

function sourceNode(name: "ref" | "runnable", runnable: boolean) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    draggable: true,
    addAttributes() {
      return sourceAttributes;
    },
    parseHTML() {
      return [{ tag: name }];
    },
    renderHTML({ HTMLAttributes }) {
      return [name, mergeAttributes(HTMLAttributes, { "data-nawc-node": name })];
    },
    addNodeView() {
      return ReactNodeViewRenderer((props) => <SourceView {...props} runnable={runnable} />);
    },
  });
}

const plugin: NawcClientPlugin = {
  name: "core",
  extensions: [Interactive, sourceNode("ref", false), sourceNode("runnable", true)],
};
export default plugin;
