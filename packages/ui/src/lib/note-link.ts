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
    if (!url.pathname.startsWith(notePrefix)) return undefined;
    const raw = decodeURIComponent(url.pathname.slice(notePrefix.length));
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
