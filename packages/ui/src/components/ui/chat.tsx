import { ArrowDownIcon, FileIcon, WrenchIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button } from "@nawcui/components/ui/button";
import { cn } from "@nawcui/lib/utils";

const MessageScrollerContext = createContext<{
  readonly atEnd: boolean;
  jumpToEnd(): void;
} | null>(null);

function MessageScroller({ className, children, ...props }: ComponentProps<"div">) {
  const viewport = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  const jumpToEnd = () => viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  useEffect(() => {
    if (atEnd) jumpToEnd();
  });
  return (
    <MessageScrollerContext value={{ atEnd, jumpToEnd }}>
      <div
        ref={viewport}
        data-slot="message-scroller"
        className={cn("relative min-h-0 overflow-y-auto", className)}
        onScroll={(event) => {
          const element = event.currentTarget;
          setAtEnd(element.scrollHeight - element.scrollTop - element.clientHeight < 32);
        }}
        {...props}
      >
        {children}
      </div>
    </MessageScrollerContext>
  );
}

function MessageScrollerButton() {
  const context = useContext(MessageScrollerContext);
  if (!context || context.atEnd) return null;
  return (
    <Button
      aria-label="Jump to latest message"
      className="sticky bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
      size="icon-sm"
      variant="secondary"
      onClick={() => context.jumpToEnd()}
    >
      <ArrowDownIcon />
    </Button>
  );
}

function Message({ role, className, ...props }: ComponentProps<"article"> & { role: string }) {
  return (
    <article
      data-role={role}
      data-slot="message"
      className={cn("flex min-w-0 flex-col gap-1.5", role === "user" && "items-end", className)}
      {...props}
    />
  );
}

function Bubble({ role, className, ...props }: ComponentProps<"div"> & { role: string }) {
  return (
    <div
      data-role={role}
      data-slot="bubble"
      className={cn(
        "max-w-[92%] min-w-0 rounded-lg px-3 py-2 text-sm leading-6 whitespace-pre-wrap",
        role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function Attachment({
  kind,
  children,
}: {
  readonly kind: "file" | "skill" | "note";
  readonly children: ReactNode;
}) {
  const Icon = kind === "skill" ? WrenchIcon : FileIcon;
  return (
    <span
      data-slot="attachment"
      className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs text-muted-foreground"
    >
      <Icon />
      <span className="truncate">{children}</span>
    </span>
  );
}

function Marker({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      data-slot="marker"
      className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}
    >
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export { Attachment, Bubble, Marker, Message, MessageScroller, MessageScrollerButton };
