"use client";

import { Button } from "@nawcui/components/ui/button";
import { ScrollArea, ScrollBar } from "@nawcui/components/ui/scroll-area";
import { cn } from "@nawcui/lib/utils";
import type { ComponentProps } from "react";
import { useCallback } from "react";

export type SuggestionsProps = ComponentProps<typeof ScrollArea>;

export const Suggestions = ({ className, children, ...props }: SuggestionsProps) => (
  <ScrollArea className="max-h-44 w-full" {...props}>
    <div className={cn("flex w-full flex-col gap-1.5 pr-3", className)}>{children}</div>
    <ScrollBar />
  </ScrollArea>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = "outline",
  size = "sm",
  children,
  ...props
}: SuggestionProps) => {
  const handleClick = useCallback(() => {
    onClick?.(suggestion);
  }, [onClick, suggestion]);

  return (
    <Button
      className={cn(
        "h-auto min-h-8 w-full cursor-pointer justify-start px-3 py-2 text-left whitespace-normal",
        className,
      )}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children || suggestion}
    </Button>
  );
};
