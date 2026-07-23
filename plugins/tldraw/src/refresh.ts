export type FileChange = {
  readonly event?: string;
  readonly file?: string;
};

function isSameFile(configured: string, changed: string): boolean {
  const normalizedConfigured = configured.replaceAll("\\", "/");
  const normalizedChanged = changed.replaceAll("\\", "/");
  return (
    normalizedConfigured === normalizedChanged ||
    normalizedConfigured.endsWith(`/${normalizedChanged}`)
  );
}

export function shouldRefreshTldraw(
  change: FileChange,
  files: { readonly snapshot: string; readonly script: string },
  suppressSnapshot: boolean,
): boolean {
  if (change.event !== "change" || !change.file) return false;
  if (files.script && isSameFile(files.script, change.file)) return true;
  return !suppressSnapshot && isSameFile(files.snapshot, change.file);
}
