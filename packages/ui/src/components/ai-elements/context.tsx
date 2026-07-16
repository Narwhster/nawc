import type { NawcProviderUsage } from "@nawc/config";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  style: "percent",
});
const tokenFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});

type ContextSchema = {
  readonly usedTokens: number;
  readonly maxTokens: number;
  readonly usage?: NawcProviderUsage;
};

const ContextValue = createContext<ContextSchema | null>(null);

function useContextValue() {
  const value = useContext(ContextValue);
  if (!value) throw new Error("Context components must be used within Context");
  return value;
}

export type ContextProps = ComponentProps<typeof HoverCard> & ContextSchema;

export function Context({ usedTokens, maxTokens, usage, ...props }: ContextProps) {
  const value = useMemo(() => ({ maxTokens, usedTokens, usage }), [maxTokens, usedTokens, usage]);
  return (
    <ContextValue.Provider value={value}>
      <HoverCard closeDelay={0} openDelay={0} {...props} />
    </ContextValue.Provider>
  );
}

function ContextIcon() {
  const { maxTokens, usedTokens } = useContextValue();
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const usedPercent = Math.min(1, usedTokens / maxTokens);
  return (
    <svg aria-label="Model context usage" height="20" role="img" viewBox="0 0 24 24" width="20">
      <circle
        cx="12"
        cy="12"
        fill="none"
        opacity="0.25"
        r={radius}
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="12"
        cy="12"
        fill="none"
        opacity="0.7"
        r={radius}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={circumference * (1 - usedPercent)}
        strokeLinecap="round"
        strokeWidth="2"
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
}

export type ContextTriggerProps = ComponentProps<typeof Button>;

export function ContextTrigger({ children, ...props }: ContextTriggerProps) {
  const { maxTokens, usedTokens } = useContextValue();
  return (
    <HoverCardTrigger asChild>
      {children ?? (
        <Button type="button" variant="ghost" {...props}>
          <span className="font-medium text-muted-foreground">
            {percentFormatter.format(Math.min(1, usedTokens / maxTokens))}
          </span>
          <ContextIcon />
        </Button>
      )}
    </HoverCardTrigger>
  );
}

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export function ContextContent({ className, ...props }: ContextContentProps) {
  return (
    <HoverCardContent
      className={cn("min-w-60 divide-y overflow-hidden p-0", className)}
      {...props}
    />
  );
}

export function ContextContentHeader({ children, className, ...props }: ComponentProps<"div">) {
  const { maxTokens, usedTokens } = useContextValue();
  const usedPercent = Math.min(1, usedTokens / maxTokens);
  return (
    <div className={cn("w-full space-y-2 p-3", className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span>{percentFormatter.format(usedPercent)} used</span>
            <span className="font-mono text-muted-foreground">
              {tokenFormatter.format(usedTokens)} / {tokenFormatter.format(maxTokens)}
            </span>
          </div>
          <Progress value={usedPercent * 100} />
        </>
      )}
    </div>
  );
}

export function ContextContentBody({
  children,
  className,
  ...props
}: ComponentProps<"div"> & { readonly children?: ReactNode }) {
  const { usage } = useContextValue();
  const rows = [
    ["Input", usage?.input],
    ["Output", usage?.output],
  ] as const;
  return (
    <div className={cn("flex w-full flex-col gap-1.5 p-3 text-xs", className)} {...props}>
      {children ??
        rows.map(([label, value]) =>
          value === undefined ? null : (
            <div className="flex items-center justify-between gap-3" key={label}>
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono">{tokenFormatter.format(value)}</span>
            </div>
          ),
        )}
    </div>
  );
}
