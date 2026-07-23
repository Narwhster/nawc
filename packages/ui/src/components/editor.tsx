import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import configuredPlugins from "virtual:nawc-plugins";
import { useEffect, useRef } from "react";
import { shouldApplyExternalContent } from "@nawcui/lib/editor-sync";
import {
  normalizeNoteContent,
  normalizeSelfClosingNodes,
  serializeNote,
} from "@nawcui/lib/serialize";
import { notePath, WikiLink } from "@nawcui/lib/wiki-link";

type EditorProps = {
  note?: string;
  content: string;
  onSave: (content: string) => Promise<void>;
  onNavigate: (note: string, newPanel: boolean) => void;
};

const configuredNodeTags = configuredPlugins.flatMap(
  (plugin) => plugin.tags ?? plugin.extensions.map((extension) => extension.name),
);

export function Editor({ note, content, onSave, onNavigate }: EditorProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveQueue = useRef(Promise.resolve());
  const hasLocalChanges = useRef(false);
  const editor = useEditor(
    {
      extensions: [
        WikiLink,
        StarterKit,
        ...configuredPlugins.flatMap((plugin) => plugin.extensions),
      ],
      content: normalizeNoteContent(content, configuredNodeTags),
      editorProps: {
        attributes: { class: "nawc-editor-content" },
        transformPastedHTML: (html) => normalizeSelfClosingNodes(html, configuredNodeTags),
        handleClickOn: (_view, _position, node, _nodePosition, event) => {
          if (node.type.name !== "wikiLink") return false;
          const target = String(node.attrs.target);
          onNavigate(notePath(target), event.metaKey || event.ctrlKey);
          return true;
        },
      },
      onUpdate: ({ editor: current }) => {
        hasLocalChanges.current = true;
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          const next = serializeNote(current);
          const save = saveQueue.current.then(() => onSave(next));
          saveQueue.current = save.then(
            () => undefined,
            () => undefined,
          );
          void save.then(
            () => {
              if (serializeNote(current) === next) hasLocalChanges.current = false;
            },
            () => undefined,
          );
        }, 350);
      },
    },
    [note],
  );

  useEffect(() => {
    if (
      editor &&
      shouldApplyExternalContent(serializeNote(editor), content, hasLocalChanges.current)
    ) {
      const timer = setTimeout(
        () =>
          editor.commands.setContent(normalizeNoteContent(content, configuredNodeTags), {
            emitUpdate: false,
          }),
        0,
      );
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
