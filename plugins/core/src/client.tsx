import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { IDisposable } from "@xterm/xterm";
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
import { copyText } from "@nawc/ui/lib/clipboard";
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
import { syntaxes } from "virtual:nawc-plugins";
import { highlightSource, sourceLanguage } from "./source-highlighting.js";

type SourceAttrs = {
  file: string;
  source?: string;
  syntax?: string;
  name?: string;
  type?: string;
  params?: string;
};
type SourceResult = SourceAttrs & { code: string; startLine: number; endLine: number };

declare global {
  interface Window {
    __nawcBrowserRun?: (selection: SourceAttrs, write: (output: string) => void) => Promise<void>;
  }
}

const resizeReporter = `<script>
(() => {
  const report = () => {
    const body = document.body;
    if (!body) return;
    const style = getComputedStyle(body);
    const margins = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    parent.postMessage({ type: "nawc:interactive-resize", height: Math.ceil(body.scrollHeight + margins) }, "*");
  };
  new ResizeObserver(report).observe(document.documentElement);
  new ResizeObserver(report).observe(document.body);
  addEventListener("load", report);
  requestAnimationFrame(report);
})();
</script>`;

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
      dangerouslySetInnerHTML={{ __html: highlightSource(code, syntax, file, syntaxes) }}
      data-language={sourceLanguage(syntax, file, syntaxes)}
    />
  );
}

function HighlightedTextarea({
  value,
  onChange,
  syntax = "html",
}: {
  value: string;
  onChange: (value: string) => void;
  syntax?: string;
}) {
  const codeRef = useRef<HTMLPreElement>(null);

  return (
    <div className="nawc-code-editor">
      <pre ref={codeRef} aria-hidden="true">
        <HighlightedCode code={value} syntax={syntax} />
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

function useSource(attrs: SourceAttrs | undefined) {
  const [source, setSource] = useState<SourceResult>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    if (!attrs) return;
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
  }, [attrs?.file, attrs?.name, attrs?.params, attrs?.syntax, attrs?.type]);
  useEffect(() => {
    if (!attrs) return;
    void load();
    const refresh = () => void load();
    window.addEventListener("nawc:files-changed", refresh);
    return () => window.removeEventListener("nawc:files-changed", refresh);
  }, [attrs?.file, load]);
  return { error, source };
}

function InteractiveView({ node, deleteNode, updateAttributes }: NodeViewProps) {
  const file = String(node.attrs.file ?? "");
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>();
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(String(node.attrs.source ?? ""));
  const { error, source: externalSource } = useSource(file ? { file } : undefined);
  const html = file ? externalSource?.code : String(node.attrs.source ?? "");
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
  return (
    <NodeViewWrapper className="nawc-node-shell">
      {error ? (
        <div className="nawc-node-error" role="alert">
          <p>{error}</p>
        </div>
      ) : (
        <iframe
          ref={frame}
          title="Interactive prototype"
          sandbox="allow-scripts"
          srcDoc={`${html ?? ""}${resizeReporter}`}
          style={{ height }}
          className="nawc-interactive-frame"
        />
      )}
      <Ribbon
        onDelete={deleteNode}
        onEdit={
          file
            ? undefined
            : () => {
                setSource(String(node.attrs.source ?? ""));
                setEditing(true);
              }
        }
        onPrompt={() =>
          promptForNode("interactive", file ? { file } : { source: node.attrs.source })
        }
        source={externalSource}
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

function SourceView({
  node,
  deleteNode,
  updateAttributes,
  runnable,
}: NodeViewProps & { runnable: boolean }) {
  const attrs = node.attrs as SourceAttrs;
  const inline = !attrs.file;
  const { error, source: externalSource } = useSource(inline ? undefined : attrs);
  const source = inline
    ? {
        ...attrs,
        code: attrs.source ?? "",
        startLine: 1,
        endLine: (attrs.source ?? "").split("\n").length,
      }
    : externalSource;
  const [runId, setRunId] = useState(0);
  const [editing, setEditing] = useState(false);
  const [inlineSource, setInlineSource] = useState(attrs.source ?? "");
  return (
    <NodeViewWrapper className="nawc-node-shell">
      <details className="nawc-source-block" open={error ? true : undefined}>
        <summary>
          <ChevronDownIcon />{" "}
          <span>{inline ? `Inline ${attrs.syntax ?? "code"}` : attrs.file}</span>
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
              <Button size="xs" variant="outline" onClick={() => void copyText(error)}>
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
        onEdit={
          inline
            ? () => {
                setInlineSource(attrs.source ?? "");
                setEditing(true);
              }
            : undefined
        }
        onPrompt={() => promptForNode(runnable ? "runnable" : "code", attrs)}
        onRun={runnable ? () => setRunId((id) => id + 1) : undefined}
        source={inline ? undefined : source}
      />
      {inline && (
        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogContent size="editor" instant>
            <DialogHeader>
              <DialogTitle>Edit code</DialogTitle>
            </DialogHeader>
            <HighlightedTextarea
              value={inlineSource}
              onChange={setInlineSource}
              syntax={attrs.syntax}
            />
            <DialogFooter>
              <Button
                onClick={() => {
                  updateAttributes({ source: inlineSource });
                  setEditing(false);
                }}
              >
                Apply
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </NodeViewWrapper>
  );
}

function RunnableTerminal({ selection }: { selection: SourceAttrs }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let resize: ResizeObserver | undefined;
    let input: IDisposable | undefined;
    let terminalResize: IDisposable | undefined;
    let socket: WebSocket | undefined;
    let terminal: XTerm | undefined;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/xterm/css/xterm.css"),
      ]);
      if (disposed || !container.current) return;

      const styles = getComputedStyle(document.documentElement);
      const color = (property: string) => styles.getPropertyValue(property).trim();
      const next = new Terminal({
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
      if (disposed) {
        next.dispose();
        return;
      }
      terminal = next;
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(container.current);
      fit.fit();
      terminal.focus();

      resize = new ResizeObserver(() => fit.fit());
      resize.observe(container.current);

      if (window.__nawcBrowserRun) {
        void window
          .__nawcBrowserRun(selection, (output) => {
            if (!disposed) terminal?.write(output.replaceAll("\n", "\r\n"));
          })
          .catch((error: unknown) => {
            if (!disposed)
              terminal?.writeln(
                `\r\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m`,
              );
          });
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/run`);
      socket.addEventListener("open", () => {
        if (!terminal || !socket) return;
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
        if (message.type === "output") terminal?.write(message.data);
        else if (message.type === "error")
          terminal?.writeln(`\r\n\x1b[31m${message.message}\x1b[0m`);
      });
      socket.addEventListener("close", (event) => {
        if (event.code !== 1000)
          terminal?.writeln(
            `\r\n\x1b[31mProcess disconnected: ${event.reason || "unknown error"}\x1b[0m`,
          );
      });
      input = terminal.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: "input", data }));
      });
      terminalResize = terminal.onResize(({ cols, rows }) => {
        if (socket?.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: "resize", cols, rows }));
      });
    })();

    return () => {
      disposed = true;
      resize?.disconnect();
      input?.dispose();
      terminalResize?.dispose();
      socket?.close(1000, "Terminal closed");
      terminal?.dispose();
    };
  }, [
    selection.file,
    selection.name,
    selection.params,
    selection.source,
    selection.syntax,
    selection.type,
  ]);

  return <div aria-label="Runnable terminal" className="nawc-run-terminal" ref={container} />;
}

const sourceAttributes = {
  file: { default: undefined },
  syntax: { default: undefined },
  name: { default: undefined },
  type: { default: undefined },
  params: { default: undefined },
};

export const Interactive = Node.create({
  name: "interactive",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      file: { default: undefined },
      source: { default: "", parseHTML: (element) => element.innerHTML },
    };
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

function sourceNode({
  name,
  tag,
  parseTag = tag,
  runnable,
}: {
  name: string;
  tag: string;
  parseTag?: string;
  runnable: boolean;
}) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    draggable: true,
    addAttributes() {
      return {
        ...sourceAttributes,
        source: {
          default: undefined,
          parseHTML: (element) =>
            element.getAttribute("data-nawc-source") ?? element.textContent ?? "",
        },
      };
    },
    parseHTML() {
      return [{ tag: parseTag, priority: 1000 }];
    },
    renderHTML({ HTMLAttributes }) {
      return [
        tag,
        mergeAttributes(HTMLAttributes, {
          "data-nawc-node": tag,
          ...(!HTMLAttributes.file ? { "data-nawc-source": HTMLAttributes.source } : {}),
        }),
      ];
    },
    addNodeView() {
      return ReactNodeViewRenderer((props) => <SourceView {...props} runnable={runnable} />);
    },
  });
}

const plugin: NawcClientPlugin = {
  name: "core",
  tags: ["interactive", "code", "runnable"],
  extensions: [
    Interactive,
    // The tiptap extension name must differ from "code" so the StarterKit code
    // mark keeps its commands, input rules, and storage; only the HTML tag is
    // "code". Block code elements are disambiguated from the inline code mark
    // by the data-nawc-node attribute (stamped on note load and by renderHTML),
    // and the rule outranks the mark's bare `code` tag rule.
    sourceNode({
      name: "sourceCode",
      tag: "code",
      parseTag: 'code[data-nawc-node="code"]',
      runnable: false,
    }),
    sourceNode({ name: "runnable", tag: "runnable", runnable: true }),
  ],
};
export default plugin;
