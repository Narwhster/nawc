import type { NawcEditorIcon } from "@nawc/config";
import { Code2Icon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { api, json } from "../lib/api";

type EditorInfo = { name: string; label: string; icon?: NawcEditorIcon };
type Meta = { editor: EditorInfo };

let editorInfo: Promise<EditorInfo> | undefined;
function configuredEditor() {
  editorInfo ??= api<Meta>("/api/meta").then((meta) => meta.editor);
  return editorInfo;
}

function EditorIcon({ icon }: { icon?: NawcEditorIcon }) {
  if (!icon) return <Code2Icon />;
  return (
    <svg aria-hidden="true" viewBox={icon.viewBox} fill="currentColor" data-editor-icon={icon.name}>
      {icon.paths.map((path, index) => (
        <path key={`${path}-${index}`} d={path} />
      ))}
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
            <EditorIcon icon={editor?.icon} />
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
