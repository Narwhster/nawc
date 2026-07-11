export type ComposerTrigger = {
  readonly kind: "file" | "skill" | "slash-command" | "slash-model" | "slash-reasoning";
  readonly query: string;
  readonly start: number;
  readonly end: number;
};

export type PromptReferenceInput =
  | { readonly type: "file"; readonly path: string }
  | { readonly type: "skill"; readonly name: string };

export function detectComposerTrigger(text: string, cursor: number): ComposerTrigger | undefined {
  const end = Math.max(0, Math.min(text.length, cursor));
  const lineStart = text.lastIndexOf("\n", Math.max(0, end - 1)) + 1;
  const linePrefix = text.slice(lineStart, end);
  const modelMatch = /^\/model(?:\s+(.*))?$/i.exec(linePrefix);
  if (modelMatch) {
    return {
      kind: "slash-model",
      query: (modelMatch[1] ?? "").trim(),
      start: lineStart,
      end,
    };
  }
  const reasoningMatch = /^\/reasoning(?:\s+(.*))?$/i.exec(linePrefix);
  if (reasoningMatch) {
    return {
      kind: "slash-reasoning",
      query: (reasoningMatch[1] ?? "").trim(),
      start: lineStart,
      end,
    };
  }
  const commandMatch = /^\/(\S*)$/.exec(linePrefix);
  if (commandMatch) {
    return { kind: "slash-command", query: commandMatch[1] ?? "", start: lineStart, end };
  }
  let start = end;
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) start -= 1;
  const token = text.slice(start, end);
  if (token.startsWith("@")) return { kind: "file", query: token.slice(1), start, end };
  if (token.startsWith("$")) return { kind: "skill", query: token.slice(1), start, end };
  return undefined;
}

function quoteMention(path: string): string {
  return /^[^\s@"\\]+$/.test(path)
    ? `@${path}`
    : `@"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function completeComposerTrigger(
  text: string,
  trigger: ComposerTrigger,
  value: string,
): { readonly text: string; readonly cursor: number } {
  const replacement =
    trigger.kind === "file" ? quoteMention(value) : trigger.kind === "skill" ? `$${value}` : value;
  return replaceComposerTrigger(text, trigger, replacement);
}

export function replaceComposerTrigger(
  text: string,
  trigger: ComposerTrigger,
  replacement: string,
  appendSeparator = true,
): { readonly text: string; readonly cursor: number } {
  const suffix = text.slice(trigger.end);
  const separator = appendSeparator && (suffix.length === 0 || !/^\s/.test(suffix)) ? " " : "";
  const next = `${text.slice(0, trigger.start)}${replacement}${separator}${suffix}`;
  return { text: next, cursor: trigger.start + replacement.length + separator.length };
}

export function collectPromptReferences(text: string): readonly PromptReferenceInput[] {
  const references: PromptReferenceInput[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/(^|\s)@(?:"((?:\\.|[^"\\])*)"|([^\s@"]+))(?=\s|$)/g)) {
    const path = (match[2] ?? match[3] ?? "").replace(/\\(.)/g, "$1");
    if (path && !seen.has(`file:${path}`)) {
      seen.add(`file:${path}`);
      references.push({ type: "file", path });
    }
  }
  for (const match of text.matchAll(/(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g)) {
    const name = match[2] ?? "";
    if (name && !seen.has(`skill:${name}`)) {
      seen.add(`skill:${name}`);
      references.push({ type: "skill", name });
    }
  }
  return references;
}
