import { useEffect, useState } from "react";
import { Button } from "@nawcui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nawcui/components/ui/dialog";
import { Input } from "@nawcui/components/ui/input";
import { displayName, type WorkspaceEntry } from "@nawcui/lib/workspace";

export type WorkspaceDialogState =
  | { kind: "create-note"; parent: string }
  | { kind: "create-folder"; parent: string }
  | { kind: "rename"; entry: WorkspaceEntry }
  | { kind: "delete"; entry: WorkspaceEntry }
  | { kind: "replace"; entry: WorkspaceEntry; to: string };

export function WorkspaceDialog({
  state,
  onOpenChange,
  onSubmit,
}: {
  state?: WorkspaceDialogState;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value?: string) => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => setValue(state?.kind === "rename" ? displayName(state.entry.path) : ""), [state]);
  if (!state) return null;
  const confirming = state.kind === "delete" || state.kind === "replace";
  const title =
    state.kind === "delete"
      ? `Delete “${displayName(state.entry.path)}”?`
      : state.kind === "replace"
        ? "File already exists"
        : state.kind === "rename"
          ? `Rename ${state.entry.type}`
          : state.kind === "create-folder"
            ? "New folder"
            : "New note";
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {state.kind === "delete"
              ? `This permanently deletes the ${state.entry.type}${state.entry.type === "folder" ? " and everything inside it" : ""}.`
              : state.kind === "replace"
                ? `A file named “${displayName(state.to)}” already exists at the destination. Do you want to replace it?`
                : state.kind === "rename"
                  ? "Enter a new name. The file extension is managed automatically."
                  : `Create it in ${state.parent ? `src/${state.parent}` : "src"}.`}
          </DialogDescription>
        </DialogHeader>
        {!confirming && (
          <form
            id="workspace-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (value.trim()) onSubmit(value.trim());
            }}
          >
            <Input
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-label="Name"
            />
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            form={confirming ? undefined : "workspace-dialog-form"}
            type={confirming ? "button" : "submit"}
            variant={state.kind === "delete" ? "destructive" : "default"}
            onClick={confirming ? () => onSubmit() : undefined}
          >
            {state.kind === "delete"
              ? "Delete"
              : state.kind === "replace"
                ? "Replace"
                : state.kind === "rename"
                  ? "Rename"
                  : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
