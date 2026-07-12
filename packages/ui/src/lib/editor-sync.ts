export function shouldApplyExternalContent(
  currentContent: string,
  incomingContent: string,
  hasLocalChanges: boolean,
): boolean {
  return currentContent !== incomingContent && !hasLocalChanges;
}
