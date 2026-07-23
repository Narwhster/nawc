import { notePath } from "./wiki-link";

const notePrefix = "/note/";

export function noteLinkHref(path: string): string {
  return `${notePrefix}${notePath(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

export function parseNoteLink(
  href: string | null | undefined,
  base = typeof window === "undefined" ? "http://localhost" : window.location.href,
): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, base);
    const hashPath = url.hash.startsWith(`#${notePrefix}`) ? url.hash.slice(1) : undefined;
    const path = hashPath ?? url.pathname;
    const index = path.lastIndexOf(notePrefix);
    if (index < 0) return undefined;
    const raw = decodeURIComponent(path.slice(index + notePrefix.length));
    if (
      !raw ||
      raw.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    )
      return undefined;
    return notePath(raw);
  } catch {
    return undefined;
  }
}
