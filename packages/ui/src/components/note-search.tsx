import { FileTextIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { api } from "@/lib/api";

type NoteSearchResult = {
  readonly path: string;
  readonly title: string;
  readonly snippet: string;
  readonly terms: readonly string[];
};

function Highlight({ text, terms }: { text: string; terms: readonly string[] }) {
  const normalized = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!normalized.length) return text;
  const pattern = new RegExp(
    `(${normalized.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return text
    .split(pattern)
    .map((part, index) =>
      normalized.some((term) => term.toLowerCase() === part.toLowerCase()) ? (
        <mark key={index}>{part}</mark>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    );
}

export function NoteSearchDialog({
  open,
  revision,
  onOpenChange,
  onOpenNote,
}: {
  readonly open: boolean;
  readonly revision: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenNote: (path: string, newPanel?: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const newPanel = useRef(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setLoading(false);
      setError(undefined);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([]);
      setLoading(false);
      setError(undefined);
      return;
    }
    setResults([]);
    setLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setError(undefined);
      void api<NoteSearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((next) => setResults(next))
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 120);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [open, query, revision]);

  const choose = (result: NoteSearchResult) => {
    onOpenNote(result.path, newPanel.current);
    onOpenChange(false);
    setQuery("");
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search notes"
      description="Search note names, paths, and content."
      className="nawc-search-dialog"
    >
      <Command
        shouldFilter={false}
        onKeyDownCapture={(event) => {
          if (event.key === "Enter") newPanel.current = event.metaKey || event.ctrlKey;
        }}
      >
        <CommandInput placeholder="Search notes…" value={query} onValueChange={setQuery} />
        <CommandList className="nawc-search-results">
          {!query.trim() && <CommandEmpty>Search note names, paths, and content.</CommandEmpty>}
          {query.trim() && loading && !results.length && <CommandEmpty>Searching…</CommandEmpty>}
          {error && <CommandEmpty>Search failed: {error}</CommandEmpty>}
          {query.trim() && !loading && !error && !results.length && (
            <CommandEmpty>No matching notes.</CommandEmpty>
          )}
          {results.length > 0 && (
            <CommandGroup>
              {results.map((result) => (
                <CommandItem
                  key={result.path}
                  value={result.path}
                  onSelect={() => choose(result)}
                  className="nawc-search-item"
                >
                  <FileTextIcon aria-hidden="true" />
                  <span className="nawc-search-item-text">
                    <strong>
                      <Highlight text={result.title} terms={result.terms} />
                    </strong>
                    <small>{result.path}</small>
                    {result.snippet && (
                      <span className="nawc-search-snippet">
                        <Highlight text={result.snippet} terms={result.terms} />
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
        <footer className="nawc-search-footer">
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
          <span>⌘↵ New panel</span>
        </footer>
      </Command>
    </CommandDialog>
  );
}
