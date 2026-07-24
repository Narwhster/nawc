import { useCallback, useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

function subscribe(key: string, callback: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(callback);

  return () => {
    set!.delete(callback);
    if (set!.size === 0) listeners.delete(key);
  };
}

function emit(key: string): void {
  queueMicrotask(() => listeners.get(key)?.forEach((l) => l()));
}

const cache = new Map<string, { raw: string | null; parsed: unknown }>();

function isPrimitive(value: unknown): value is string | number | boolean {
  return value === null || (typeof value !== "object" && typeof value !== "function");
}

function serialize<T>(value: T): string {
  return isPrimitive(value) ? String(value) : JSON.stringify(value);
}

function deserialize<T>(raw: string, initialValue: T): T {
  if (isPrimitive(initialValue)) {
    if (typeof initialValue === "number") return Number(raw) as T;
    if (typeof initialValue === "boolean") return (raw === "true") as T;
    return raw as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return initialValue;
  }
}

function read<T>(key: string, initialValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    const cached = cache.get(key);
    if (cached && cached.raw === raw) return cached.parsed as T;
    const parsed = raw !== null ? deserialize(raw, initialValue) : initialValue;
    cache.set(key, { raw, parsed });
    return parsed;
  } catch {
    return initialValue;
  }
}

export function useLocalStorageState<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(
    useCallback((cb) => subscribe(key, cb), [key]),
    useCallback(() => read(key, initialValue), [key, initialValue]),
    useCallback(() => initialValue, [initialValue]),
  );

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === "function" ? (next as (prev: T) => T)(read(key, initialValue)) : next;
      try {
        const raw = serialize(resolved);
        localStorage.setItem(key, raw);
        cache.set(key, { raw, parsed: resolved });
      } catch {
        // quota exceeded or private mode — ignore
      }
      emit(key);
    },
    [key, initialValue],
  );

  return [value, setValue];
}
