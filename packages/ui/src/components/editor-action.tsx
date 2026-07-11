import { Code2Icon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { api, json } from "../lib/api";

type EditorInfo = { name: string; label: string; icon?: string };
type Meta = { editor: EditorInfo };

let editorInfo: Promise<EditorInfo> | undefined;
function configuredEditor() {
  editorInfo ??= api<Meta>("/api/meta").then((meta) => meta.editor);
  return editorInfo;
}

function VsCodeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.6 2.1 8.4 10.4 3.2 6.5 1 7.8v8.4l2.2 1.3 5.2-3.9 9.2 8.3L23 19.3V4.7l-5.4-2.6Zm0 5.2v9.4l-6.2-4.7 6.2-4.7Z" />
    </svg>
  );
}

export function EditorAction({
  file,
  scope,
  line,
  column,
  side,
}: {
  file?: string;
  scope: "note" | "source";
  line?: number;
  column?: number;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const [editor, setEditor] = useState<EditorInfo>();
  const [error, setError] = useState<string>();
  const errorId = useId();
  useEffect(() => {
    void configuredEditor()
      .then(setEditor)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, []);
  const label = editor ? `Open in ${editor.label}` : "Open in editor";
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-describedby={error ? errorId : undefined}
            aria-label={label}
            disabled={!file}
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              if (!file) return;
              setError(undefined);
              void api("/api/editor/open", json({ file, scope, line, column })).catch(
                (cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
              );
            }}
          >
            {editor?.icon === "vscode" ? <VsCodeIcon /> : <Code2Icon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
      {error && (
        <div className="nawc-editor-launch-error" id={errorId} role="alert">
          <strong>{label} failed</strong>
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => setError(undefined)}>
            Dismiss
          </Button>
        </div>
      )}
    </>
  );
}
