import { SendIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type PromptEvent = {
  type: string;
  text?: string;
  message?: string;
  command?: string;
  status?: string;
};

export function PromptPanel({ note }: { note?: string }) {
  const [prompt, setPrompt] = useState("");
  const [events, setEvents] = useState<PromptEvent[]>([]);
  const [running, setRunning] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const fill = (event: Event) => {
      setPrompt((event as CustomEvent<string>).detail);
      textarea.current?.focus();
    };
    window.addEventListener("nawc:prompt", fill);
    return () => window.removeEventListener("nawc:prompt", fill);
  }, []);
  const send = async () => {
    if (!prompt.trim() || running) return;
    setEvents([]);
    setRunning(true);
    try {
      const response = await fetch("/api/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: `Current NAWC note: ${note ?? "none"}\n\n${prompt}` }),
      });
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
        <SparklesIcon />
        <strong>Agent</strong>
      </header>
      <div className="nawc-prompt-events">
        {events.length === 0 && (
          <p>
            Ask about the current note. Codex syntax such as <code>$skill</code> and{" "}
            <code>@file</code> is passed through unchanged.
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
        <Textarea
          ref={textarea}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask the agent…"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
          }}
        />
        <Button disabled={running || !prompt.trim()} onClick={() => void send()}>
          <SendIcon data-icon="inline-start" />
          {running ? "Running" : "Send"}
        </Button>
      </div>
    </aside>
  );
}
