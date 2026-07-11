import hljs from "highlight.js/lib/common";

const languageAliases: Record<string, string> = {
  bash: "bash",
  cjs: "javascript",
  css: "css",
  htm: "xml",
  html: "xml",
  js: "javascript",
  javascript: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  mjs: "javascript",
  py: "python",
  python: "python",
  sh: "bash",
  shell: "bash",
  sql: "sql",
  test: "typescript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  vitest: "typescript",
  vue: "xml",
  xml: "xml",
  zsh: "bash",
};

function normalizeLanguage(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^\./, "");
  return languageAliases[normalized] ?? normalized;
}

function extensionOf(file?: string) {
  const extension = file?.split(/[\\/.]/).pop();
  return extension && extension !== file ? extension : undefined;
}

export function sourceLanguage(syntax?: string, file?: string) {
  for (const candidate of [syntax, extensionOf(file)]) {
    if (!candidate) continue;
    const language = normalizeLanguage(candidate);
    if (hljs.getLanguage(language)) return language;
  }
  return undefined;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function highlightSource(code: string, syntax?: string, file?: string) {
  const language = sourceLanguage(syntax, file);
  return language
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : escapeHtml(code);
}
