import { CheckIcon, CopyIcon } from "lucide-react";
import { isValidElement, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Button } from "@nawcui/components/ui/button";
import { copyText } from "@nawcui/lib/clipboard";
import { parseNoteLink } from "@nawcui/lib/note-link";

function CopyButton({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      aria-label="Copy"
      size="icon-xs"
      variant="ghost"
      onClick={() => {
        void copyText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          })
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : String(error)),
          );
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

export function MarkdownRenderer({ children }: { readonly children: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children: label, href, ...props }) => {
          const path = parseNoteLink(href);
          if (path) {
            return (
              <a
                className="underline underline-offset-4"
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  window.dispatchEvent(
                    new CustomEvent("nawc:open-note", { detail: { path, newPanel: true } }),
                  );
                }}
              >
                {label}
              </a>
            );
          }
          return (
            <a
              className="underline underline-offset-4"
              href={href}
              rel="noreferrer"
              target="_blank"
              {...props}
            >
              {label}
            </a>
          );
        },
        blockquote: ({ children: quote }) => (
          <blockquote className="border-l-2 pl-3 text-muted-foreground">{quote}</blockquote>
        ),
        code: ({ className, children: code }) =>
          className ? (
            <code className={className}>{code}</code>
          ) : (
            <code className="rounded bg-background px-1 py-0.5 text-xs">{code}</code>
          ),
        h1: ({ children: heading }) => <h1 className="text-base font-semibold">{heading}</h1>,
        h2: ({ children: heading }) => <h2 className="text-sm font-semibold">{heading}</h2>,
        h3: ({ children: heading }) => <h3 className="text-sm font-medium">{heading}</h3>,
        ol: ({ children: items }) => <ol className="list-decimal pl-5">{items}</ol>,
        p: ({ children: paragraph }) => <p>{paragraph}</p>,
        pre: ({ children: code }) => {
          const text = nodeText(code).replace(/\n$/, "");
          return (
            <div className="group/code relative min-w-0">
              <pre className="overflow-x-auto rounded-md border bg-background p-3 text-xs">
                {code}
              </pre>
              <div className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/code:opacity-100">
                <CopyButton text={text} />
              </div>
            </div>
          );
        },
        table: ({ children: rows }) => (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">{rows}</table>
          </div>
        ),
        td: ({ children: cell }) => <td className="border p-1.5">{cell}</td>,
        th: ({ children: cell }) => <th className="border bg-muted p-1.5 text-left">{cell}</th>,
        ul: ({ children: items }) => <ul className="list-disc pl-5">{items}</ul>,
      }}
    >
      {children}
    </Markdown>
  );
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}
