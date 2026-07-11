import type { IDockviewPanelProps } from "dockview-react";
import { useCallback, useEffect, useState } from "react";
import { Editor } from "@/components/editor";
import { api, json } from "@/lib/api";

export function DocumentPane({ params }: IDockviewPanelProps<{ path: string }>) {
  const [content, setContent] = useState("");
  const load = useCallback(
    () => void api<string>(`/api/note?path=${encodeURIComponent(params.path)}`).then(setContent),
    [params.path],
  );

  useEffect(load, [load]);
  useEffect(() => {
    const onChange = (event: Event) => {
      const { file, event: type } = (event as CustomEvent<{ file?: string; event: string }>).detail;
      if (file === params.path && type === "change") load();
    };
    window.addEventListener("nawc:files-changed", onChange);
    return () => window.removeEventListener("nawc:files-changed", onChange);
  }, [load, params.path]);

  return (
    <Editor
      note={params.path}
      content={content}
      onSave={(next) => void api("/api/note", json({ path: params.path, content: next }, "PUT"))}
      onNavigate={(path, newPanel) =>
        window.dispatchEvent(new CustomEvent("nawc:open-note", { detail: { path, newPanel } }))
      }
    />
  );
}
