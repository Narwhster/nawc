import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import configuredPlugins from "virtual:nawc-plugins";
import { useEffect, useRef } from "react";
import { serializeNote } from "@/lib/serialize";
import { notePath, WikiLink } from "@/lib/wiki-link";

type EditorProps = {
  note?: string;
  content: string;
  onSave: (content: string) => void;
  onNavigate: (note: string, newPanel: boolean) => void;
};

export function Editor({ note, content, onSave, onNavigate }: EditorProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editor = useEditor(
    {
      extensions: [
        WikiLink,
        StarterKit,
        ...configuredPlugins.flatMap((plugin) => plugin.extensions),
      ],
      content,
      editorProps: {
        attributes: { class: "nawc-editor-content" },
        handleClickOn: (_view, _position, node, _nodePosition, event) => {
          if (node.type.name !== "wikiLink") return false;
          const target = String(node.attrs.target);
          onNavigate(notePath(target), event.metaKey || event.ctrlKey);
          return true;
        },
      },
      onUpdate: ({ editor: current }) => {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => onSave(serializeNote(current)), 350);
      },
    },
    [note],
  );

  useEffect(() => {
    if (editor && content && editor.getHTML() !== content) {
      const timer = setTimeout(() => editor.commands.setContent(content, { emitUpdate: false }), 0);
      return () => clearTimeout(timer);
    }
  }, [content, editor]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  if (!note)
    return (
      <div className="nawc-empty">
        <p>Select or create a note to begin.</p>
      </div>
    );
  return <EditorContent editor={editor} className="nawc-editor" />;
}
