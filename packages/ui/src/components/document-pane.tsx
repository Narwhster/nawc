import type { IDockviewPanelProps } from "dockview-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Editor } from "@/components/editor";
import { api, json } from "@/lib/api";

type LoadedNote = {
  path: string;
  content: string;
};

export function DocumentPane({ params }: IDockviewPanelProps<{ path: string }>) {
  const [loadedNote, setLoadedNote] = useState<LoadedNote>();
  const loadId = useRef(0);
  const load = useCallback(async () => {
    const id = ++loadId.current;
    const path = params.path;
    const content = await api<string>(`/api/note?path=${encodeURIComponent(path)}`);
    if (id === loadId.current) setLoadedNote({ path, content });
  }, [params.path]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const onChange = (event: Event) => {
      const { file, event: type } = (event as CustomEvent<{ file?: string; event: string }>).detail;
      if (file === params.path && type === "change") void load();
    };
    window.addEventListener("nawc:files-changed", onChange);
    return () => window.removeEventListener("nawc:files-changed", onChange);
  }, [load, params.path]);

  const content = loadedNote?.path === params.path ? loadedNote.content : undefined;
  if (content === undefined)
    return (
      <div className="nawc-empty">
        <p>Loading note…</p>
      </div>
    );

  return (
    <Editor
      note={params.path}
      content={content}
      onSave={(next) => api("/api/note", json({ path: params.path, content: next }, "PUT"))}
      onNavigate={(path, newPanel) =>
        window.dispatchEvent(new CustomEvent("nawc:open-note", { detail: { path, newPanel } }))
      }
    />
  );
}
