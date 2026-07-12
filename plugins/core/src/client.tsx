import { Node, mergeAttributes } from "@tiptap/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
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
import { EditorAction } from "@nawc/ui/components/editor-action";
import {
  ChevronDownIcon,
  CopyIcon,
  PencilIcon,
  PlayIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
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
  source,
}: {
  onDelete: () => void;
  onEdit?: () => void;
  onPrompt: () => void;
  onRun?: () => void;
  source?: SourceResult;
}) {
  return (
    <div className="nawc-node-ribbon" contentEditable={false}>
      {onRun && (
        <IconAction label="Run" onClick={onRun}>
          <PlayIcon />
        </IconAction>
      )}
      {source && (
        <EditorAction file={source.file} line={source.startLine} scope="source" side="right" />
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

function fixSourceError(error: string, attrs: SourceAttrs) {
  window.dispatchEvent(new Event("nawc:open-agent"));
  window.dispatchEvent(
    new CustomEvent("nawc:agent-context", {
      detail: {
        prompt: `Fix the failing ${attrs.file} source reference.`,
        reference: {
          type: "diagnostic",
          message: error,
          file: attrs.file,
        },
      },
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
  const [runId, setRunId] = useState(0);
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
  return (
    <NodeViewWrapper className="nawc-node-shell">
      <details className="nawc-source-block" open={error ? true : undefined}>
        <summary>
          <ChevronDownIcon /> <span>{attrs.file}</span>
          {attrs.name && (
            <span className="text-muted-foreground">
              {attrs.type} {attrs.name}
            </span>
          )}
        </summary>
        {error ? (
          <div className="nawc-node-error" role="alert">
            <p>{error}</p>
            <div className="flex gap-1" contentEditable={false}>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void navigator.clipboard.writeText(error)}
              >
                <CopyIcon data-icon="inline-start" /> Copy
              </Button>
              <Button size="xs" variant="outline" onClick={() => fixSourceError(error, attrs)}>
                <SparklesIcon data-icon="inline-start" /> Fix with agent
              </Button>
            </div>
          </div>
        ) : (
          <pre className="nawc-source-code">
            <HighlightedCode
              code={source?.code ?? "Loading…"}
              file={source?.file ?? attrs.file}
              syntax={source?.syntax ?? attrs.syntax}
            />
          </pre>
        )}
        {runId > 0 && <RunnableTerminal key={runId} selection={attrs} />}
      </details>
      <Ribbon
        onDelete={deleteNode}
        onPrompt={() => promptForNode(runnable ? "runnable" : "ref", attrs)}
        onRun={runnable ? () => setRunId((id) => id + 1) : undefined}
        source={source}
      />
    </NodeViewWrapper>
  );
}

function RunnableTerminal({ selection }: { selection: SourceAttrs }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const styles = getComputedStyle(document.documentElement);
    const color = (property: string) => styles.getPropertyValue(property).trim();
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      scrollback: 5_000,
      theme: {
        background: color("--background"),
        foreground: color("--foreground"),
        cursor: color("--foreground"),
        selectionBackground: color("--terminal-selection"),
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current);
    fit.fit();
    terminal.focus();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/run`);
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "start",
          selection,
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as
        | { type: "output"; data: string }
        | { type: "exit"; exitCode: number }
        | { type: "error"; message: string };
      if (message.type === "output") terminal.write(message.data);
      else if (message.type === "error") terminal.writeln(`\r\n\x1b[31m${message.message}\x1b[0m`);
    });
    socket.addEventListener("close", (event) => {
      if (event.code !== 1000)
        terminal.writeln(
          `\r\n\x1b[31mProcess disconnected: ${event.reason || "unknown error"}\x1b[0m`,
        );
    });
    const input = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "input", data }));
    });
    const terminalResize = terminal.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "resize", cols, rows }));
    });
    const resize = new ResizeObserver(() => fit.fit());
    resize.observe(container.current);

    return () => {
      resize.disconnect();
      input.dispose();
      terminalResize.dispose();
      socket.close(1000, "Terminal closed");
      terminal.dispose();
    };
  }, [selection.file, selection.name, selection.syntax, selection.type]);

  return <div aria-label="Runnable terminal" className="nawc-run-terminal" ref={container} />;
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
