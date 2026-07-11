export type WorkspaceEntry = {
  path: string;
  type: "file" | "folder";
};

export function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function dirname(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export function displayName(path: string): string {
  const name = basename(path);
  return name.endsWith(".html") ? name.slice(0, -5) : name;
}
