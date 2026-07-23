import { createShapeId, toRichText, type Editor, type TLShapeId } from "tldraw";

type Box = {
  id: TLShapeId;
  x: number;
  y: number;
  label: string;
  color: "blue" | "green" | "orange";
};

const boxes: readonly Box[] = [
  { id: createShapeId("notebook"), x: 80, y: 80, label: "NAWC notebook", color: "blue" },
  { id: createShapeId("canvas"), x: 420, y: 80, label: "tldraw canvas", color: "green" },
  { id: createShapeId("agent"), x: 250, y: 280, label: "Coding agent", color: "orange" },
];

export default function buildArchitecture(editor: Editor) {
  editor.run(() => {
    for (const box of boxes) {
      const shape = {
        id: box.id,
        type: "geo" as const,
        x: box.x,
        y: box.y,
        props: {
          geo: "rectangle" as const,
          w: 240,
          h: 96,
          richText: toRichText(box.label),
          color: box.color,
        },
      };
      if (editor.getShape(box.id)) editor.updateShape(shape);
      else editor.createShape(shape);
    }
  });

  editor.zoomToFit({ animation: { duration: 300 } });
}
