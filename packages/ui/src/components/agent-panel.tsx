import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  FileIcon,
  GaugeIcon,
  LoaderCircleIcon,
  PlusIcon,
  RotateCcwIcon,
  PaperclipIcon,
  SendIcon,
  SquareIcon,
  TerminalIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import type { NawcProviderUsage } from "@nawc/config";
import { createId } from "@paralleldrive/cuid2";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ChatMarkdown } from "@/components/chat-markdown";
import { copyText } from "@/lib/clipboard";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextTrigger,
} from "@/components/ai-elements/context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { parseNoteLink } from "@/lib/note-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Attachment,
  Bubble,
  Marker,
  Message,
  MessageScroller,
  MessageScrollerButton,
} from "@/components/ui/chat";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, json } from "@/lib/api";
import {
  collectPromptReferences,
  completeComposerTrigger,
  detectComposerTrigger,
  replaceComposerTrigger,
  type ComposerTrigger,
} from "@/lib/composer";

type Reference =
  | { readonly type: "file"; readonly path: string }
  | { readonly type: "skill"; readonly name: string; readonly path?: string }
  | { readonly type: "note"; readonly path: string; readonly content?: string }
  | { readonly type: "diagnostic"; readonly message: string; readonly file?: string };
type MessageData = {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly turnId: string;
  readonly createdAt: string;
  readonly streaming: boolean;
  readonly references?: readonly Reference[];
  readonly attachments?: readonly Omit<ImageAttachment, "dataUrl">[];
};
type ImageAttachment = {
  readonly type: "image";
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly dataUrl: string;
};
type Activity = {
  readonly id: string;
  readonly turnId: string;
  readonly tool: string;
  readonly title: string;
  readonly status: "running" | "completed" | "failed" | "declined";
  readonly output?: string;
};
type AgentRequest = {
  readonly id: string;
  readonly turnId: string;
  readonly title: string;
  readonly details?: string;
  readonly status: "pending" | "resolved";
};
type Turn = {
  readonly id: string;
  readonly status: "running" | "completed" | "interrupted" | "failed";
  readonly plan?: string;
  readonly usage?: NawcProviderUsage;
};
type AgentThread = {
  readonly id: string;
  readonly provider: string;
  readonly providerThreadId?: string;
  readonly updatedAt: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly mode?: string;
  readonly status: "idle" | "running" | "error";
  readonly turns: readonly Turn[];
  readonly messages: readonly MessageData[];
  readonly activities: readonly Activity[];
  readonly requests: readonly AgentRequest[];
  readonly warnings: readonly string[];
};
type ModelOption = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly contextWindow?: number;
  readonly defaultReasoningEffort?: string;
  readonly reasoningEfforts?: readonly { readonly id: string; readonly description?: string }[];
  readonly options?: readonly (
    | {
        readonly id: string;
        readonly label: string;
        readonly type: "select";
        readonly choices: readonly { readonly id: string; readonly label: string }[];
        readonly defaultValue?: string;
      }
    | {
        readonly id: string;
        readonly label: string;
        readonly type: "boolean";
        readonly defaultValue?: boolean;
      }
  )[];
};
type ProviderMetadata = {
  readonly name: string;
  readonly label: string;
  readonly capabilities: readonly string[];
  readonly modes: readonly {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
  }[];
};
type Completion = {
  readonly kind: "file" | "skill" | "command" | "model" | "reasoning";
  readonly value: string;
  readonly detail: string;
};
type AgentPreferences = {
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly mode?: string;
  readonly options?: Readonly<Record<string, string | boolean>>;
};
type ProviderSettings = Omit<AgentPreferences, "options"> & {
  readonly options?: readonly { readonly id: string; readonly value: string | boolean }[];
};

const PREFERENCES_KEY = "nawc:agent-preferences:v1";
const DRAFTS_KEY = "nawc:agent-drafts:v1";
const THREAD_KEY = "nawc:agent-active-thread:v1";

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

function threadLabel(thread: AgentThread): string {
  const firstPrompt = thread.messages.find((message) => message.role === "user")?.text.trim();
  return firstPrompt ? firstPrompt.slice(0, 48) : `Conversation ${formatTime(thread.updatedAt)}`;
}

function copy(text: string) {
  void copyText(text)
    .then(() => toast.success("Copied"))
    .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)));
}

function requestPreferences(preferences: AgentPreferences) {
  return {
    model: preferences.model,
    reasoningEffort: preferences.reasoningEffort,
    mode: preferences.mode,
    options: Object.entries(preferences.options ?? {}).map(([id, value]) => ({ id, value })),
  };
}

function readImage(file: File): Promise<ImageAttachment> {
  if (!file.type.startsWith("image/"))
    return Promise.reject(new Error(`${file.name} is not an image`));
  if (file.size > 10 * 1024 * 1024)
    return Promise.reject(new Error(`${file.name} is larger than 10 MB`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not encode ${file.name}`));
        return;
      }
      resolve({
        type: "image",
        id: createId(),
        name: file.name || "pasted-image.png",
        mimeType: file.type,
        sizeBytes: file.size,
        dataUrl: reader.result,
      });
    };
    reader.readAsDataURL(file);
  });
}

export function CompletionMenu({
  anchor,
  completions,
  activeCompletion,
  onChoose,
}: {
  readonly anchor: HTMLTextAreaElement | null;
  readonly completions: readonly Completion[];
  readonly activeCompletion: number;
  readonly onChoose: (completion: Completion) => void;
}) {
  const [position, setPosition] = useState<{
    readonly left: number;
    readonly bottom: number;
    readonly width: number;
    readonly maxHeight: number;
  }>();

  useLayoutEffect(() => {
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      setPosition({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 4,
        width: rect.width,
        maxHeight: Math.max(96, Math.min(256, rect.top - 16)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor]);

  if (!position) return null;
  return createPortal(
    <div
      className="fixed z-50 overflow-auto rounded-md border bg-popover p-1 shadow-lg"
      role="listbox"
      style={position}
    >
      {completions.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">No matches</p>
      ) : (
        completions.map((completion, index) => (
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs data-[active=true]:bg-muted"
            data-active={index === activeCompletion}
            key={`${completion.kind}:${completion.value}`}
            onMouseDown={(event) => {
              event.preventDefault();
              onChoose(completion);
            }}
            type="button"
          >
            {completion.kind === "file" ? (
              <FileIcon />
            ) : completion.kind === "skill" ? (
              <WrenchIcon />
            ) : completion.kind === "model" ? (
              <BotIcon />
            ) : completion.kind === "reasoning" ? (
              <GaugeIcon />
            ) : (
              <TerminalIcon />
            )}
            <span className="min-w-0 flex-1 truncate">
              {completion.kind === "skill"
                ? `$${completion.value}`
                : completion.kind === "command"
                  ? `/${completion.value}`
                  : completion.value}
            </span>
            <span className="truncate text-muted-foreground">{completion.detail}</span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}

function ModelPicker({
  models,
  value,
  onSelect,
}: {
  readonly models: readonly ModelOption[];
  readonly value: string;
  readonly onSelect: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = models.find((model) => model.id === value) ?? models[0];

  return (
    <>
      <Button
        aria-label="Model"
        className="min-w-0 border-0 shadow-none"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <span className="truncate">{selected?.name}</span>
      </Button>
      <CommandDialog
        description="Search the available models by name or provider ID."
        onOpenChange={setOpen}
        open={open}
        title="Choose a model"
      >
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList>
            <CommandEmpty>No matching models.</CommandEmpty>
            <CommandGroup>
              {models.map((model) => (
                <CommandItem
                  key={model.id}
                  onSelect={() => {
                    onSelect(model.id);
                    setOpen(false);
                  }}
                  value={`${model.id} ${model.name}`}
                >
                  <span className="min-w-0 flex-1 truncate">{model.name}</span>
                  <span className="truncate text-muted-foreground">{model.id}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-0.75">
        <span className="size-1 animate-pulse rounded-full bg-muted-foreground/40" />
        <span className="size-1 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:200ms]" />
        <span className="size-1 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:400ms]" />
      </span>
      <span>Thinking…</span>
    </div>
  );
}

function TurnActivity({
  turn,
  activities,
}: {
  readonly turn: Turn;
  readonly activities: readonly Activity[];
}) {
  if (activities.length === 0 && !turn.plan) return null;
  return (
    <Collapsible className="rounded-md border bg-muted/30" defaultOpen={false}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-muted-foreground">
        {turn.status === "running" ? <Spinner /> : <CheckCircle2Icon />}
        <span className="flex-1">
          {turn.status === "running" ? "Working" : `${activities.length} activities`}
        </span>
        <ChevronDownIcon />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1 border-t p-2">
        {turn.plan && <ChatMarkdown>{turn.plan}</ChatMarkdown>}
        {activities.map((activity) => (
          <Collapsible key={activity.id}>
            <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-xs hover:bg-muted">
              {activity.status === "running" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <TerminalIcon />
              )}
              <span className="min-w-0 flex-1 truncate">{activity.title}</span>
              <Badge variant={activity.status === "failed" ? "destructive" : "secondary"}>
                {activity.status}
              </Badge>
            </CollapsibleTrigger>
            {activity.output && (
              <CollapsibleContent>
                <pre className="mt-1 max-h-48 overflow-auto rounded-sm bg-background p-2 text-xs whitespace-pre-wrap">
                  {activity.output}
                </pre>
              </CollapsibleContent>
            )}
          </Collapsible>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AgentPanel({ note }: { readonly note?: string }) {
  const [provider, setProvider] = useState<ProviderMetadata>();
  const [threads, setThreads] = useState<readonly AgentThread[]>([]);
  const [threadId, setThreadId] = useState(() => localStorage.getItem(THREAD_KEY) ?? "");
  const [models, setModels] = useState<readonly ModelOption[]>([]);
  const [preferences, setPreferences] = useState<AgentPreferences>(() =>
    readStorage(PREFERENCES_KEY, {}),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(() => readStorage(DRAFTS_KEY, {}));
  const [running, setRunning] = useState(false);
  const [trigger, setTrigger] = useState<ComposerTrigger>();
  const [completions, setCompletions] = useState<readonly Completion[]>([]);
  const [pendingReferences, setPendingReferences] = useState<readonly Reference[]>([]);
  const [activeCompletion, setActiveCompletion] = useState(0);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [attachments, setAttachments] = useState<readonly ImageAttachment[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const pendingAgentChanges = useRef(new Map<string, AgentThread | null>());
  const threadRefreshId = useRef(0);
  const thread = threads.find((item) => item.id === threadId);
  const draftKey = threadId || "new";
  const prompt = drafts[draftKey] ?? "";
  const selectedModel = models.find((item) => item.id === preferences.model);
  const threadModel = models.find((item) => item.id === thread?.model);
  const latestUsage = thread?.turns.findLast((turn) => turn.usage)?.usage;
  const contextWindow = latestUsage?.contextWindow ?? threadModel?.contextWindow;
  const usedTokens =
    latestUsage?.total ?? (latestUsage ? (latestUsage.input ?? 0) + (latestUsage.output ?? 0) : 0);
  const reasoningOptions = useMemo(() => selectedModel?.reasoningEfforts ?? [], [selectedModel]);
  const latestMessageIdByTurn = useMemo(() => {
    const ids = new Map<string, string>();
    for (const message of thread?.messages ?? []) ids.set(message.turnId, message.id);
    return ids;
  }, [thread?.messages]);

  const refreshThreads = useCallback(async () => {
    const refreshId = ++threadRefreshId.current;
    pendingAgentChanges.current = new Map();
    const next = await api<AgentThread[]>("/api/agent/threads");
    if (refreshId !== threadRefreshId.current) return next;
    setThreads(() => {
      const merged = new Map(next.map((item) => [item.id, item]));
      const changes = pendingAgentChanges.current;
      pendingAgentChanges.current = new Map();
      for (const [id, thread] of changes) {
        if (thread) merged.set(id, thread);
        else merged.delete(id);
      }
      return [...merged.values()].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    });
    setThreadsLoaded(true);
    return next;
  }, []);

  useEffect(() => {
    void Promise.all([
      api<ProviderMetadata>("/api/agent/provider").then(setProvider),
      api<ModelOption[]>("/api/prompt/models").then(setModels),
      api<ProviderSettings>("/api/prompt/settings").then((settings) =>
        setPreferences((current) => ({
          ...settings,
          options: settings.options
            ? Object.fromEntries(settings.options.map(({ id, value }) => [id, value]))
            : undefined,
          ...current,
        })),
      ),
      refreshThreads(),
    ]).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error)),
    );
  }, [refreshThreads]);

  useEffect(() => {
    if (threadsLoaded && threadId && !threads.some((item) => item.id === threadId)) setThreadId("");
  }, [threadId, threads, threadsLoaded]);

  useEffect(() => {
    const onAgentEventsReconnected = () =>
      void refreshThreads().catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      );
    window.addEventListener("nawc:agent-events-reconnected", onAgentEventsReconnected);
    const onAgentChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          threadId: string;
          thread?: AgentThread | null;
        }>
      ).detail;
      const thread = detail.thread;
      if (thread === undefined) return;
      pendingAgentChanges.current.set(detail.threadId, thread);
      if (thread === null) {
        setThreads((current) => current.filter(({ id }) => id !== detail.threadId));
        return;
      }
      setThreads((current) => {
        const next = current.filter(({ id }) => id !== detail.threadId);
        next.push(thread);
        return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      });
    };
    window.addEventListener("nawc:agent-changed", onAgentChange);
    return () => {
      window.removeEventListener("nawc:agent-events-reconnected", onAgentEventsReconnected);
      window.removeEventListener("nawc:agent-changed", onAgentChange);
    };
  }, [refreshThreads]);

  useEffect(
    () => localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)),
    [preferences],
  );
  useEffect(() => localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)), [drafts]);
  useEffect(() => {
    if (threadId) localStorage.setItem(THREAD_KEY, threadId);
    else localStorage.removeItem(THREAD_KEY);
  }, [threadId]);

  useEffect(() => {
    const fill = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      setDrafts((current) => ({ ...current, [draftKey]: value }));
      requestAnimationFrame(() => textarea.current?.focus());
    };
    window.addEventListener("nawc:prompt", fill);
    const context = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt: string; reference: Reference }>).detail;
      setDrafts((current) => ({ ...current, [draftKey]: detail.prompt }));
      setPendingReferences((current) => [...current, detail.reference]);
      requestAnimationFrame(() => textarea.current?.focus());
    };
    window.addEventListener("nawc:agent-context", context);
    return () => {
      window.removeEventListener("nawc:prompt", fill);
      window.removeEventListener("nawc:agent-context", context);
    };
  }, [draftKey]);

  useEffect(() => {
    if (!trigger) {
      setCompletions((current) => (current.length === 0 ? current : []));
      return;
    }
    const controller = new AbortController();
    const request: Promise<readonly Completion[]> =
      trigger.kind === "file"
        ? api<{ path: string; kind: string }[]>(
            `/api/prompt/files?q=${encodeURIComponent(trigger.query)}`,
            { signal: controller.signal },
          ).then((items) =>
            items.map((item) => ({ kind: "file" as const, value: item.path, detail: item.kind })),
          )
        : trigger.kind === "skill"
          ? api<{ name: string; source: string; shortDescription?: string }[]>(
              "/api/prompt/skills",
              { signal: controller.signal },
            ).then((items) =>
              items
                .filter((item) => item.name.toLowerCase().includes(trigger.query.toLowerCase()))
                .map((item) => ({
                  kind: "skill" as const,
                  value: item.name,
                  detail: item.shortDescription ?? item.source,
                })),
            )
          : trigger.kind === "slash-model"
            ? Promise.resolve(
                models
                  .filter(
                    (model) =>
                      !trigger.query ||
                      model.id.toLowerCase().includes(trigger.query.toLowerCase()) ||
                      model.name.toLowerCase().includes(trigger.query.toLowerCase()),
                  )
                  .map((model) => ({
                    kind: "model" as const,
                    value: model.id,
                    detail: model.description ?? model.name,
                  })),
              )
            : trigger.kind === "slash-reasoning"
              ? Promise.resolve(
                  reasoningOptions
                    .filter(
                      (effort) =>
                        !trigger.query ||
                        effort.id.toLowerCase().includes(trigger.query.toLowerCase()) ||
                        effort.description?.toLowerCase().includes(trigger.query.toLowerCase()),
                    )
                    .map((effort) => ({
                      kind: "reasoning" as const,
                      value: effort.id,
                      detail: effort.description ?? effort.id,
                    })),
                )
              : api<{ name: string; description?: string }[]>("/api/prompt/commands", {
                  signal: controller.signal,
                }).then((items) => {
                  const builtIns = [
                    { name: "new", description: "Start a new conversation" },
                    { name: "model", description: "Choose a model below" },
                    ...(reasoningOptions.length > 0
                      ? [{ name: "reasoning", description: "Choose reasoning effort" }]
                      : []),
                    ...(provider?.modes.map((mode) => ({
                      name: mode.id,
                      description: mode.description ?? `Switch to ${mode.label}`,
                    })) ?? []),
                  ];
                  return [...builtIns, ...items]
                    .filter((item) => item.name.toLowerCase().includes(trigger.query.toLowerCase()))
                    .map((item) => ({
                      kind: "command" as const,
                      value: item.name,
                      detail: item.description ?? "Provider command",
                    }));
                });
    void request
      .then((items) => {
        setCompletions(items);
        setActiveCompletion(0);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [models, provider, reasoningOptions, trigger]);

  const updatePrompt = (value: string, cursor = value.length) => {
    setDrafts((current) => ({ ...current, [draftKey]: value }));
    setTrigger(detectComposerTrigger(value, cursor));
  };

  const selectModel = (model: string) => {
    const selected = models.find((item) => item.id === model);
    setPreferences((current) => ({
      ...current,
      model,
      reasoningEffort: selected?.defaultReasoningEffort,
      options: Object.fromEntries(
        (selected?.options ?? []).flatMap((option) =>
          option.defaultValue === undefined ? [] : [[option.id, option.defaultValue]],
        ),
      ),
    }));
  };

  const chooseCompletion = (completion: Completion) => {
    if (!trigger) return;
    if (completion.kind === "model") {
      const replaced = replaceComposerTrigger(prompt, trigger, "", false);
      selectModel(completion.value);
      updatePrompt(replaced.text.trimStart());
      setTrigger(undefined);
      return;
    }
    if (completion.kind === "reasoning") {
      const replaced = replaceComposerTrigger(prompt, trigger, "", false);
      setPreferences((current) => ({ ...current, reasoningEffort: completion.value }));
      updatePrompt(replaced.text.trimStart());
      setTrigger(undefined);
      return;
    }
    if (completion.kind === "command") {
      if (completion.value === "new") {
        const replaced = replaceComposerTrigger(prompt, trigger, "", false);
        updatePrompt(replaced.text.trimStart());
        setThreadId("");
        setTrigger(undefined);
      } else if (completion.value === "model" || completion.value === "reasoning") {
        const completed = replaceComposerTrigger(prompt, trigger, `/${completion.value} `, false);
        updatePrompt(completed.text, completed.cursor);
      } else if (provider?.modes.some((mode) => mode.id === completion.value)) {
        const replaced = replaceComposerTrigger(prompt, trigger, "", false);
        setPreferences((current) => ({ ...current, mode: completion.value }));
        updatePrompt(replaced.text.trimStart());
        setTrigger(undefined);
      } else {
        const completed = replaceComposerTrigger(prompt, trigger, `/${completion.value}`);
        updatePrompt(completed.text, completed.cursor);
        setTrigger(undefined);
      }
      return;
    }
    const completed = completeComposerTrigger(prompt, trigger, completion.value);
    updatePrompt(completed.text, completed.cursor);
    setTrigger(undefined);
    requestAnimationFrame(() =>
      textarea.current?.setSelectionRange(completed.cursor, completed.cursor),
    );
  };

  const send = async () => {
    if ((!prompt.trim() && attachments.length === 0) || running) return;
    setRunning(true);
    let activeThreadId = threadId;
    try {
      if (!activeThreadId) {
        const created = await api<AgentThread>(
          "/api/agent/threads",
          json(requestPreferences(preferences)),
        );
        activeThreadId = created.id;
        setThreads((current) =>
          current.some((item) => item.id === created.id) ? current : [created, ...current],
        );
        setThreadId(created.id);
      }
      setDrafts((current) => ({ ...current, [draftKey]: "", [activeThreadId]: "" }));
      const references = [...collectPromptReferences(prompt), ...pendingReferences];
      const response = await fetch(
        `/api/agent/threads/${encodeURIComponent(activeThreadId)}/turns`,
        json({
          prompt: prompt || "Review the attached image.",
          note,
          references,
          attachments,
          ...requestPreferences(preferences),
        }),
      );
      if (!response.ok || !response.body) throw new Error(await response.text());
      setPendingReferences([]);
      setAttachments([]);
      const reader = response.body.getReader();
      while (true) {
        const result = await reader.read();
        if (result.done) break;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
      requestAnimationFrame(() => textarea.current?.focus());
    }
  };

  const interrupt = async () => {
    if (!threadId) return;
    try {
      await api(`/api/agent/threads/${encodeURIComponent(threadId)}/interrupt`, json({}));
      setRunning(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const turnById = useMemo(() => new Map(thread?.turns.map((turn) => [turn.id, turn])), [thread]);

  return (
    <aside className="nawc-agent-panel flex h-full min-h-0 flex-col border-l bg-background">
      <header className="nawc-agent-header flex h-11 shrink-0 items-center gap-2 overflow-hidden border-b px-2">
        <BotIcon className="shrink-0" />
        {threads.length > 0 ? (
          <Select value={threadId || undefined} onValueChange={setThreadId}>
            <SelectTrigger
              aria-label="Conversation"
              className="min-w-0 flex-1 border-0 px-1 shadow-none"
              size="sm"
            >
              <SelectValue placeholder={provider?.label ?? "Agent"} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Conversations</SelectLabel>
                {threads.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {threadLabel(item)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <strong className="min-w-0 flex-1 truncate text-xs">{provider?.label ?? "Agent"}</strong>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="New conversation"
              size="icon-xs"
              variant="ghost"
              onClick={() => setThreadId("")}
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New conversation</TooltipContent>
        </Tooltip>
        {thread && (
          <Button
            aria-label="Delete conversation"
            size="icon-xs"
            variant="ghost"
            onClick={() => {
              void api(`/api/agent/threads/${encodeURIComponent(thread.id)}`, {
                method: "DELETE",
              }).then(() => {
                setThreadId("");
              });
            }}
          >
            <Trash2Icon />
          </Button>
        )}
      </header>

      {!thread || thread.messages.length === 0 ? (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BotIcon />
            </EmptyMedia>
            <EmptyTitle>Work with your agent</EmptyTitle>
            <EmptyDescription>
              The current note is attached automatically. Use @ for project files and $ for skills.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <MessageScroller
          className="flex-1 p-3"
          onClickCapture={(event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const anchor = target.closest("a");
            if (!(anchor instanceof HTMLAnchorElement)) return;
            const path = parseNoteLink(anchor.href);
            if (!path) return;
            event.preventDefault();
            event.stopPropagation();
            window.dispatchEvent(
              new CustomEvent("nawc:open-note", { detail: { path, newPanel: true } }),
            );
          }}
        >
          <div className="flex flex-col gap-4">
            {thread.messages.map((message) => {
              const turn = turnById.get(message.turnId);
              const activities = thread.activities.filter((item) => item.turnId === message.turnId);
              const pendingRequests =
                latestMessageIdByTurn.get(message.turnId) === message.id
                  ? thread.requests.filter(
                      (item) => item.turnId === message.turnId && item.status === "pending",
                    )
                  : [];
              const showTurnActivity = turn !== undefined && message.role === "assistant";
              return (
                <Message key={message.id} role={message.role}>
                  <Bubble role={message.role}>
                    {message.role === "assistant" ? (
                      <ChatMarkdown>{message.text}</ChatMarkdown>
                    ) : (
                      message.text
                    )}
                    {message.streaming && <Spinner className="ml-2 inline-flex" />}
                  </Bubble>
                  {showTurnActivity && <TurnActivity turn={turn} activities={activities} />}
                  {message.references && message.references.length > 0 && (
                    <div className="flex max-w-[92%] flex-wrap justify-end gap-1">
                      {message.references.map((reference, index) =>
                        reference.type === "diagnostic" ? null : (
                          <Attachment kind={reference.type} key={`${reference.type}:${index}`}>
                            {reference.type === "skill" ? `$${reference.name}` : reference.path}
                          </Attachment>
                        ),
                      )}
                    </div>
                  )}
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="flex max-w-[92%] flex-wrap justify-end gap-1">
                      {message.attachments.map((attachment) => (
                        <Attachment kind="file" key={attachment.id}>
                          {attachment.name}
                        </Attachment>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span>{formatTime(message.createdAt)}</span>
                    <Button
                      aria-label="Copy message"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => copy(message.text)}
                    >
                      <CopyIcon />
                    </Button>
                    {message.role === "user" && (
                      <Button
                        aria-label="Reuse message"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => {
                          updatePrompt(message.text);
                          requestAnimationFrame(() => textarea.current?.focus());
                        }}
                      >
                        <RotateCcwIcon />
                      </Button>
                    )}
                  </div>
                  {pendingRequests.map((request) => (
                    <Alert key={request.id}>
                      <CircleAlertIcon />
                      <AlertTitle>{request.title}</AlertTitle>
                      {request.details && <AlertDescription>{request.details}</AlertDescription>}
                      <div className="mt-2 flex gap-2">
                        {[
                          ["decline", "Decline"],
                          ["accept", "Allow once"],
                          ["acceptForSession", "Allow for session"],
                        ].map(([decision, label]) => (
                          <Button
                            key={decision}
                            size="xs"
                            variant={decision === "decline" ? "outline" : "default"}
                            onClick={() => {
                              void api(
                                `/api/agent/threads/${thread.id}/requests/${request.id}`,
                                json({ decision }),
                              );
                            }}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </Alert>
                  ))}
                </Message>
              );
            })}
            {thread.turns
              .filter(
                (turn) =>
                  turn.status === "running" &&
                  !thread.messages.some(
                    (item) => item.role === "assistant" && item.turnId === turn.id,
                  ),
              )
              .map((turn) => {
                const activities = thread.activities.filter((item) => item.turnId === turn.id);
                const isThinking = activities.length === 0 && !turn.plan;
                return (
                  <Message key={`turn-activity:${turn.id}`} role="assistant">
                    {isThinking ? (
                      <ThinkingIndicator />
                    ) : (
                      <TurnActivity turn={turn} activities={activities} />
                    )}
                  </Message>
                );
              })}
            {thread.warnings.map((warning, index) => (
              <Alert variant="destructive" key={`${warning}:${index}`}>
                <CircleAlertIcon />
                <AlertTitle>Agent error</AlertTitle>
                <AlertDescription>{warning}</AlertDescription>
              </Alert>
            ))}
            <Marker>{thread.status === "running" ? "Agent is working" : "Latest"}</Marker>
          </div>
          <MessageScrollerButton />
        </MessageScroller>
      )}

      <div className="nawc-agent-composer relative flex min-h-0 shrink flex-col gap-2 border-t p-2">
        {trigger && (
          <CompletionMenu
            anchor={textarea.current}
            completions={completions}
            activeCompletion={activeCompletion}
            onChoose={chooseCompletion}
          />
        )}
        {note && (
          <div className="flex">
            <Attachment kind="note">{note}</Attachment>
          </div>
        )}
        {pendingReferences.map((reference, index) => (
          <Badge key={`${reference.type}:${index}`} variant="secondary">
            <CircleAlertIcon />
            {reference.type === "diagnostic" ? reference.message : reference.type}
            <button
              aria-label="Remove context"
              onClick={() =>
                setPendingReferences((current) => current.filter((_, item) => item !== index))
              }
              type="button"
            >
              ×
            </button>
          </Badge>
        ))}
        {attachments.length > 0 && (
          <div className="flex gap-2 overflow-x-auto">
            {attachments.map((attachment) => (
              <div className="group/image relative shrink-0" key={attachment.id}>
                <img
                  alt={attachment.name}
                  className="size-16 rounded-md border object-cover"
                  src={attachment.dataUrl}
                />
                <Button
                  aria-label={`Remove ${attachment.name}`}
                  className="absolute -top-1 -right-1 rounded-full"
                  size="icon-xs"
                  variant="secondary"
                  onClick={() =>
                    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
                  }
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
        )}
        <input
          accept="image/*"
          className="sr-only"
          multiple
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            void Promise.all(files.map(readImage))
              .then((next) => setAttachments((current) => [...current, ...next].slice(0, 8)))
              .catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : String(error)),
              );
            event.target.value = "";
          }}
          ref={imageInput}
          type="file"
        />
        <InputGroup>
          <InputGroupTextarea
            ref={textarea}
            aria-label="Message the agent"
            placeholder="Ask the agent…  @ files · $ skills · / commands"
            value={prompt}
            onChange={(event) => updatePrompt(event.target.value, event.target.selectionStart)}
            onPaste={(event) => {
              if (!provider?.capabilities.includes("attachments")) return;
              const images = [...event.clipboardData.files].filter((file) =>
                file.type.startsWith("image/"),
              );
              if (images.length === 0) return;
              event.preventDefault();
              void Promise.all(images.map(readImage))
                .then((next) => setAttachments((current) => [...current, ...next].slice(0, 8)))
                .catch((error: unknown) =>
                  toast.error(error instanceof Error ? error.message : String(error)),
                );
            }}
            onKeyDown={(event) => {
              if (trigger && completions.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveCompletion(
                    (current) =>
                      (current + (event.key === "ArrowDown" ? 1 : -1) + completions.length) %
                      completions.length,
                  );
                  return;
                }
                if (
                  (event.key === "Enter" || event.key === "Tab") &&
                  completions[activeCompletion]
                ) {
                  event.preventDefault();
                  chooseCompletion(completions[activeCompletion]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setTrigger(undefined);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <InputGroupAddon className="nawc-agent-input-addon" align="block-end">
            <div className="nawc-agent-controls flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {provider?.capabilities.includes("attachments") && (
                <Button
                  aria-label="Attach images"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => imageInput.current?.click()}
                >
                  <PaperclipIcon />
                </Button>
              )}
              {models.length > 0 && (
                <ModelPicker
                  models={models}
                  onSelect={selectModel}
                  value={preferences.model ?? models[0]?.id ?? ""}
                />
              )}
              {reasoningOptions.length > 0 && (
                <Select
                  value={preferences.reasoningEffort ?? selectedModel?.defaultReasoningEffort}
                  onValueChange={(reasoningEffort) =>
                    setPreferences((current) => ({ ...current, reasoningEffort }))
                  }
                >
                  <SelectTrigger size="sm" className="border-0 shadow-none">
                    <GaugeIcon />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Reasoning</SelectLabel>
                      {reasoningOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.id}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
              {selectedModel?.options?.map((option) => {
                const value = preferences.options?.[option.id] ?? option.defaultValue;
                const choices =
                  option.type === "select"
                    ? option.choices
                    : [
                        { id: "true", label: "On" },
                        { id: "false", label: "Off" },
                      ];
                return (
                  <Select
                    key={option.id}
                    value={String(value ?? "")}
                    onValueChange={(next) =>
                      setPreferences((current) => ({
                        ...current,
                        options: {
                          ...current.options,
                          [option.id]: option.type === "boolean" ? next === "true" : next,
                        },
                      }))
                    }
                  >
                    <SelectTrigger
                      aria-label={option.label}
                      className="border-0 shadow-none"
                      size="sm"
                    >
                      <SelectValue placeholder={option.label} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>{option.label}</SelectLabel>
                        {choices.map((choice) => (
                          <SelectItem key={choice.id} value={choice.id}>
                            {choice.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                );
              })}
              {provider && provider.modes.length > 0 && (
                <Select
                  value={preferences.mode ?? provider.modes[0]?.id}
                  onValueChange={(mode) => setPreferences((current) => ({ ...current, mode }))}
                >
                  <SelectTrigger size="sm" className="border-0 shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Mode</SelectLabel>
                      {provider.modes.map((mode) => (
                        <SelectItem key={mode.id} value={mode.id}>
                          {mode.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            </div>
            {thread &&
              (thread.provider === "codex" || thread.provider === "opencode") &&
              latestUsage &&
              contextWindow &&
              usedTokens > 0 && (
                <Context maxTokens={contextWindow} usedTokens={usedTokens} usage={latestUsage}>
                  <ContextTrigger size="sm" />
                  <ContextContent side="top" align="end">
                    <ContextContentHeader />
                    <ContextContentBody />
                  </ContextContent>
                </Context>
              )}
            {running || thread?.status === "running" ? (
              <Button
                aria-label="Stop agent"
                size="icon-sm"
                variant="destructive"
                onClick={() => void interrupt()}
              >
                <SquareIcon />
              </Button>
            ) : (
              <Button
                aria-label="Send message"
                disabled={!prompt.trim() && attachments.length === 0}
                size="icon-sm"
                onClick={() => void send()}
              >
                <SendIcon />
              </Button>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
    </aside>
  );
}
