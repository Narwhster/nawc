import type { SourceSelection } from "@nawc/config";

export type RunClientEvent =
  | { type: "start"; selection: SourceSelection; cols: number; rows: number }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isSelection(value: unknown): value is SourceSelection {
  return (
    isRecord(value) &&
    typeof value.file === "string" &&
    value.file.length > 0 &&
    isOptionalString(value.syntax) &&
    isOptionalString(value.name) &&
    isOptionalString(value.type)
  );
}

function isDimension(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0
  );
}

export function parseRunClientEvent(value: string): RunClientEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") return;
  if (
    parsed.type === "start" &&
    isSelection(parsed.selection) &&
    isDimension(parsed.cols) &&
    isDimension(parsed.rows)
  )
    return {
      type: "start",
      selection: parsed.selection,
      cols: parsed.cols,
      rows: parsed.rows,
    };
  if (parsed.type === "input" && typeof parsed.data === "string")
    return { type: "input", data: parsed.data };
  if (parsed.type === "resize" && isDimension(parsed.cols) && isDimension(parsed.rows))
    return { type: "resize", cols: parsed.cols, rows: parsed.rows };
}

export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  try {
    const requested = new URL(`http://${host}`);
    if (requested.hostname !== "localhost" && requested.hostname !== "127.0.0.1") return false;
    return origin === requested.origin;
  } catch {
    return false;
  }
}
