import type { IDockviewPanelProps } from "dockview-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Editor } from "@nawcui/components/editor";
import { api, json } from "@nawcui/lib/api";
import { displayName } from "@nawcui/lib/workspace";

type LoadedNote = {
  path: string;
  content: string;
};

export function DocumentPane({ params, api: panelApi }: IDockviewPanelProps<{ path: string }>) {
  const [loadedNote, setLoadedNote] = useState<LoadedNote>();
  const loadId = useRef(0);
  const load = useCallback(async () => {
    const id = ++loadId.current;
    const path = params.path;
    try {
      const content = await api<string>(`/api/note?path=${encodeURIComponent(path)}`);
      if (id === loadId.current) setLoadedNote({ path, content });
    } catch {
      if (id !== loadId.current) return;
      toast.error(`Note not found: ${displayName(path)}`);
      panelApi.close();
    }
  }, [panelApi, params.path]);

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
