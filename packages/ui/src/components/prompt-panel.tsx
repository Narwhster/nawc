import {
  CommandIcon,
  CpuIcon,
  FileIcon,
  FolderIcon,
  GaugeIcon,
  SendIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, json } from "@/lib/api";
import {
  collectPromptReferences,
  completeComposerTrigger,
  detectComposerTrigger,
  replaceComposerTrigger,
  type ComposerTrigger,
  type PromptReferenceInput,
} from "@/lib/composer";

type PromptEvent = {
  type: string;
  text?: string;
  message?: string;
  command?: string;
  status?: string;
};

type SkillOption = {
  readonly name: string;
  readonly source: string;
  readonly displayName?: string;
  readonly shortDescription?: string;
  readonly description?: string;
  readonly scope?: string;
};
type PathOption = { readonly path: string; readonly kind: "file" | "directory" };
type ReasoningEffortOption = { readonly id: string; readonly description?: string };
type ModelOption = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly reasoningEfforts?: readonly ReasoningEffortOption[];
  readonly defaultReasoningEffort?: string;
};
type PromptSettings = {
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly reasoningEfforts?: readonly ReasoningEffortOption[];
};
type CommandOption = { readonly name: string; readonly description?: string };
type CompletionOption =
  | {
      readonly kind: "path";
      readonly value: string;
      readonly detail: string;
      readonly pathKind: PathOption["kind"];
    }
  | {
      readonly kind: "skill";
      readonly value: string;
      readonly detail: string;
      readonly label: string;
    }
  | { readonly kind: "command"; readonly value: string; readonly detail: string }
  | { readonly kind: "model"; readonly value: string; readonly detail: string }
  | { readonly kind: "reasoning"; readonly value: string; readonly detail: string };

type PromptMode = "default" | "plan";
const EMPTY_REASONING_OPTIONS: readonly ReasoningEffortOption[] = [];

function skillSearchScore(skill: SkillOption, query: string): number | undefined {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return 0;
  const values = [
    skill.name,
    skill.displayName,
    skill.shortDescription,
    skill.description,
    skill.scope,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  const scores = values.flatMap((value) => {
    if (value === normalized) return [0];
    if (value.startsWith(normalized)) return [1];
    if (value.includes(normalized)) return [2];
    let cursor = 0;
    for (const character of normalized) {
      cursor = value.indexOf(character, cursor);
      if (cursor < 0) return [];
      cursor += 1;
    }
    return [10 + value.length];
  });
  return scores.length > 0 ? Math.min(...scores) : undefined;
}

function searchSkills(skills: readonly SkillOption[], query: string): CompletionOption[] {
  return skills
    .flatMap((skill) => {
      const score = skillSearchScore(skill, query);
      return score === undefined
        ? []
        : [
            {
              score,
              option: {
                kind: "skill" as const,
                value: skill.name,
                label: skill.displayName ?? skill.name,
                detail: skill.shortDescription ?? skill.description ?? skill.source,
              },
            },
          ];
    })
    .sort(
      (left, right) =>
        left.score - right.score || left.option.label.localeCompare(right.option.label),
    )
    .map(({ option }) => option);
}

function referenceKey(reference: PromptReferenceInput): string {
  return reference.type === "file" ? `file:${reference.path}` : `skill:${reference.name}`;
}

export function PromptPanel({ note }: { note?: string }) {
  const [prompt, setPrompt] = useState("");
  const [events, setEvents] = useState<PromptEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [model, setModel] = useState<string>();
  const [reasoningEffort, setReasoningEffort] = useState<string>();
  const [settings, setSettings] = useState<PromptSettings>();
  const [models, setModels] = useState<readonly ModelOption[]>([]);
  const [mode, setMode] = useState<PromptMode>("default");
  const [trigger, setTrigger] = useState<ComposerTrigger>();
  const [options, setOptions] = useState<readonly CompletionOption[]>([]);
  const [activeOption, setActiveOption] = useState(0);
  const [loading, setLoading] = useState(false);
  const [completionError, setCompletionError] = useState<string>();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const completionOpen = trigger !== undefined;
  const references = useMemo(() => collectPromptReferences(prompt), [prompt]);
  const activeModel = model ?? settings?.model;
  const selectedModel = models.find((item) => item.id === activeModel);
  const activeReasoningEffort =
    reasoningEffort ?? settings?.reasoningEffort ?? selectedModel?.defaultReasoningEffort;
  const reasoningOptions =
    selectedModel?.reasoningEfforts ?? settings?.reasoningEfforts ?? EMPTY_REASONING_OPTIONS;

  useEffect(() => {
    void api<PromptSettings>("/api/prompt/settings")
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  const updatePrompt = (value: string, cursor: number) => {
    setPrompt(value);
    setTrigger(detectComposerTrigger(value, cursor));
  };

  useEffect(() => {
    const fill = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      setPrompt(value);
      requestAnimationFrame(() => {
        textarea.current?.focus();
        textarea.current?.setSelectionRange(value.length, value.length);
      });
    };
    window.addEventListener("nawc:prompt", fill);
    return () => window.removeEventListener("nawc:prompt", fill);
  }, []);

  useEffect(() => {
    if (!trigger) {
      setOptions([]);
      setCompletionError(undefined);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setCompletionError(undefined);
        const request =
          trigger.kind === "file"
            ? api<PathOption[]>(`/api/prompt/files?q=${encodeURIComponent(trigger.query)}`, {
                signal: controller.signal,
              }).then((files) =>
                files.map(
                  (file): CompletionOption => ({
                    kind: "path",
                    value: file.path,
                    pathKind: file.kind,
                    detail:
                      file.kind === "directory"
                        ? "Directory"
                        : file.path.slice(0, Math.max(0, file.path.lastIndexOf("/"))),
                  }),
                ),
              )
            : trigger.kind === "skill"
              ? api<SkillOption[]>("/api/prompt/skills", { signal: controller.signal }).then(
                  (skills) => searchSkills(skills, trigger.query),
                )
              : trigger.kind === "slash-reasoning"
                ? Promise.resolve(
                    reasoningOptions
                      .filter(
                        (item) =>
                          !trigger.query ||
                          item.id.toLowerCase().includes(trigger.query.toLowerCase()) ||
                          item.description?.toLowerCase().includes(trigger.query.toLowerCase()),
                      )
                      .map(
                        (item): CompletionOption => ({
                          kind: "reasoning",
                          value: item.id,
                          detail: item.description ?? item.id,
                        }),
                      ),
                  )
                : trigger.kind === "slash-command"
                  ? api<CommandOption[]>("/api/prompt/commands", {
                      signal: controller.signal,
                    }).then((commands) => {
                      const builtIns: CommandOption[] = [
                        { name: "model", description: "Choose the response model" },
                        ...(reasoningOptions.length > 0
                          ? [{ name: "reasoning", description: "Choose reasoning effort" }]
                          : []),
                        { name: "plan", description: "Plan changes without editing files" },
                        { name: "default", description: "Return to normal build mode" },
                      ];
                      const all = [...builtIns, ...commands];
                      const query = trigger.query.toLowerCase();
                      return all
                        .filter((command) => !query || command.name.toLowerCase().includes(query))
                        .map(
                          (command): CompletionOption => ({
                            kind: "command",
                            value: command.name,
                            detail: command.description ?? "Provider command",
                          }),
                        );
                    })
                  : api<ModelOption[]>("/api/prompt/models", { signal: controller.signal }).then(
                      (models) => {
                        setModels((current) => (current.length === 0 ? models : current));
                        const query = trigger.query.toLowerCase();
                        return models
                          .filter(
                            (item) =>
                              !query ||
                              item.id.toLowerCase().includes(query) ||
                              item.name.toLowerCase().includes(query) ||
                              item.description?.toLowerCase().includes(query),
                          )
                          .map(
                            (item): CompletionOption => ({
                              kind: "model",
                              value: item.id,
                              detail: item.description ?? item.id,
                            }),
                          );
                      },
                    );
        void request
          .then((next) => {
            setOptions(next);
            setActiveOption(0);
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted)
              setCompletionError(error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      trigger.kind === "file" ? 120 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [reasoningOptions, trigger]);

  const chooseOption = (option: CompletionOption) => {
    if (!trigger) return;
    if (option.kind === "command") {
      if (option.value === "model") {
        const completed = replaceComposerTrigger(prompt, trigger, "/model ", false);
        setPrompt(completed.text);
        setTrigger(detectComposerTrigger(completed.text, completed.cursor));
        return;
      }
      if (option.value === "reasoning") {
        const completed = replaceComposerTrigger(prompt, trigger, "/reasoning ", false);
        setPrompt(completed.text);
        setTrigger(detectComposerTrigger(completed.text, completed.cursor));
        return;
      }
      if (option.value === "plan" || option.value === "default") {
        const completed = replaceComposerTrigger(prompt, trigger, "", false);
        setPrompt(completed.text.trimStart());
        setMode(option.value);
        setTrigger(undefined);
        return;
      }
      const completed = replaceComposerTrigger(prompt, trigger, `/${option.value}`);
      setPrompt(completed.text);
      setTrigger(undefined);
      return;
    }
    if (option.kind === "model") {
      const completed = replaceComposerTrigger(prompt, trigger, "", false);
      setPrompt(completed.text.trimStart());
      setModel(option.value);
      setReasoningEffort(models.find((item) => item.id === option.value)?.defaultReasoningEffort);
      setTrigger(undefined);
      return;
    }
    if (option.kind === "reasoning") {
      const completed = replaceComposerTrigger(prompt, trigger, "", false);
      setPrompt(completed.text.trimStart());
      setReasoningEffort(option.value);
      setTrigger(undefined);
      return;
    }
    const completed = completeComposerTrigger(prompt, trigger, option.value);
    setPrompt(completed.text);
    setTrigger(undefined);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(completed.cursor, completed.cursor);
    });
  };

  const send = async () => {
    if (!prompt.trim() || running) return;
    setEvents([]);
    setRunning(true);
    try {
      const response = await fetch(
        "/api/prompt",
        json({
          prompt: `Current NAWC note: ${note ?? "none"}\n\n${prompt}`,
          references,
          ...(model ? { model } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          mode,
        }),
      );
      if (!response.ok || !response.body) throw new Error(await response.text());
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const data = block
            .split("\n")
            .find((line) => line.startsWith("data:"))
            ?.slice(5)
            .trim();
          if (data) setEvents((current) => [...current, JSON.parse(data) as PromptEvent]);
        }
      }
    } catch (error) {
      setEvents((current) => [
        ...current,
        { type: "error", message: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <aside className="nawc-prompt-panel">
      <header>
        <div className="nawc-prompt-header-main">
          <SparklesIcon />
          <strong>Agent</strong>
          {mode === "plan" && <small>Plan mode</small>}
        </div>
        <div className="nawc-prompt-header-meta">
          {activeModel && <small>{activeModel}</small>}
          {activeReasoningEffort && <small>Reasoning: {activeReasoningEffort}</small>}
        </div>
      </header>
      <div className="nawc-prompt-events">
        {events.length === 0 && (
          <p>
            Ask about the current note. Type <code>$</code> for skills or <code>@</code> for files.
          </p>
        )}
        {events.map((event, index) => (
          <div className={`nawc-agent-event ${event.type}`} key={index}>
            {event.text ??
              event.message ??
              (event.command ? `${event.status}: ${event.command}` : event.type)}
          </div>
        ))}
      </div>
      <div className="nawc-prompt-compose">
        {completionOpen && (
          <div
            className="nawc-completion-menu"
            id="nawc-prompt-completions"
            role="listbox"
            aria-label="Prompt suggestions"
          >
            <div className="nawc-completion-heading">
              {trigger.kind === "file"
                ? "Paths"
                : trigger.kind === "skill"
                  ? "Skills"
                  : trigger.kind === "slash-model"
                    ? "Models"
                    : trigger.kind === "slash-reasoning"
                      ? "Reasoning effort"
                      : "Commands"}
              <span>↑↓ navigate · ↵ select · esc close</span>
            </div>
            {loading && <div className="nawc-completion-state">Loading…</div>}
            {completionError && (
              <div className="nawc-completion-state error">Could not load: {completionError}</div>
            )}
            {!loading && !completionError && options.length === 0 && (
              <div className="nawc-completion-state">No matches</div>
            )}
            {!loading &&
              options.map((option, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeOption}
                  id={`nawc-completion-${index}`}
                  key={`${option.kind}:${option.value}`}
                  onMouseEnter={() => setActiveOption(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    chooseOption(option);
                  }}
                >
                  {option.kind === "path" ? (
                    option.pathKind === "directory" ? (
                      <FolderIcon />
                    ) : (
                      <FileIcon />
                    )
                  ) : option.kind === "skill" ? (
                    <WrenchIcon />
                  ) : option.kind === "model" ? (
                    <CpuIcon />
                  ) : option.kind === "reasoning" ? (
                    <GaugeIcon />
                  ) : (
                    <CommandIcon />
                  )}
                  <span>
                    {option.kind === "skill"
                      ? option.label
                      : option.kind === "command"
                        ? `/${option.value}`
                        : option.value}
                  </span>
                  <small>{option.detail}</small>
                </button>
              ))}
          </div>
        )}
        <Textarea
          ref={textarea}
          value={prompt}
          onChange={(event) => updatePrompt(event.target.value, event.target.selectionStart)}
          onClick={(event) =>
            setTrigger(detectComposerTrigger(prompt, event.currentTarget.selectionStart))
          }
          placeholder="Ask the agent..."
          aria-autocomplete="list"
          aria-expanded={completionOpen}
          aria-controls={completionOpen ? "nawc-prompt-completions" : undefined}
          aria-activedescendant={
            completionOpen && options[activeOption] ? `nawc-completion-${activeOption}` : undefined
          }
          onKeyDown={(event) => {
            if (completionOpen) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActiveOption((current) =>
                  options.length === 0
                    ? 0
                    : (current + direction + options.length) % options.length,
                );
                return;
              }
              if ((event.key === "Enter" || event.key === "Tab") && options[activeOption]) {
                event.preventDefault();
                chooseOption(options[activeOption]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setTrigger(undefined);
                return;
              }
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
          }}
          onKeyUp={(event) => {
            if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key))
              setTrigger(detectComposerTrigger(prompt, event.currentTarget.selectionStart));
          }}
        />
        {references.length > 0 && (
          <div className="nawc-prompt-references" aria-label="Selected references">
            {references.map((reference) => (
              <span key={referenceKey(reference)}>
                {reference.type === "file" ? <FileIcon /> : <WrenchIcon />}
                {reference.type === "file" ? reference.path : `$${reference.name}`}
              </span>
            ))}
          </div>
        )}
        <Button disabled={running || !prompt.trim()} onClick={() => void send()}>
          <SendIcon data-icon="inline-start" />
          {running ? "Running" : "Send"}
        </Button>
      </div>
    </aside>
  );
}
