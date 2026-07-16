import type { PromptReference } from "@nawc/config";

export function promptReferenceKey(reference: PromptReference): string {
  switch (reference.type) {
    case "file":
      return `file:${reference.path}`;
    case "skill":
      return `skill:${reference.name}`;
    case "note":
      return `note:${reference.path}`;
    case "diagnostic":
      return `diagnostic:${reference.file ?? ""}:${reference.line ?? ""}:${reference.message}`;
  }
}

/** Drop bulky note bodies from thread message metadata (UI only shows path chips). */
export function displayReference(reference: PromptReference): PromptReference {
  if (reference.type === "note") return { type: "note", path: reference.path };
  return reference;
}

/**
 * Full content (notes) and structured attach lines are injected once per thread.
 * Later turns keep:
 * - notes as path-only (current note still known)
 * - files/skills/diagnostics omitted (already in provider history; user text still has @/$ etc.)
 */
export function prepareTurnReferences(
  references: readonly PromptReference[],
  attachedReferenceKeys: string[],
): PromptReference[] {
  const attached = new Set(attachedReferenceKeys);
  const prepared: PromptReference[] = [];
  for (const reference of references) {
    const key = promptReferenceKey(reference);
    if (attached.has(key)) {
      if (reference.type === "note") prepared.push({ type: "note", path: reference.path });
      continue;
    }
    attached.add(key);
    attachedReferenceKeys.push(key);
    prepared.push(reference);
  }
  return prepared;
}
