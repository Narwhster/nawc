import { lazy, Suspense } from "react";

const MarkdownRenderer = lazy(() =>
  import("@/components/markdown-renderer").then((module) => ({
    default: module.MarkdownRenderer,
  })),
);

export function ChatMarkdown({ children }: { readonly children: string }) {
  return (
    <Suspense fallback={<span>{children}</span>}>
      <MarkdownRenderer>{children}</MarkdownRenderer>
    </Suspense>
  );
}
