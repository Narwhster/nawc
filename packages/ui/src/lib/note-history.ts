export type NoteHistory = {
  back: string[];
  forward: string[];
};

export type NoteHistoryDirection = "back" | "forward";

export function createNoteHistory(): NoteHistory {
  return { back: [], forward: [] };
}

export function recordNavigation(history: NoteHistory, current: string, next: string): void {
  if (current === next) return;
  history.back.push(current);
  history.forward = [];
}

export function peekHistory(
  history: NoteHistory,
  direction: NoteHistoryDirection,
): string | undefined {
  return (direction === "back" ? history.back : history.forward).at(-1);
}

export function navigateHistory(
  history: NoteHistory,
  current: string,
  direction: NoteHistoryDirection,
): string | undefined {
  const source = direction === "back" ? history.back : history.forward;
  const next = source.pop();
  if (!next) return undefined;

  const destination = direction === "back" ? history.forward : history.back;
  destination.push(current);
  return next;
}
