import { useCallback, useEffect, useState } from "react";

/**
 * A small piece of interface state that outlives the session — which view the
 * library is in, whether the sidebar is folded, how dense the rows are.
 *
 * These live in `localStorage`, not in `mods.json` through `save_setting`, for
 * two reasons. They have to be readable *synchronously* on first render, or
 * the library would visibly flip from list to grid a frame after mounting.
 * And the library file is rewritten whole on every write: a view toggle has no
 * business rewriting the mod database, which is the same reasoning that moved
 * the catalogue out of it.
 *
 * A corrupt or unreadable value falls back to the default rather than throwing
 * — a bad preference must never stop the app from rendering.
 */
export function usePreference<T>(key: string, fallback: T): [T, (value: T) => void] {
  const storageKey = `f1m24.ui.${key}`;

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage full or disabled: the preference simply does not persist.
      }
    },
    [storageKey]
  );

  // Keep two mounted readers of the same key in step — the sidebar's collapse
  // state is read by the shell and written by a shortcut, for instance.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey || e.newValue === null) return;
      try {
        setValue(JSON.parse(e.newValue) as T);
      } catch {
        // Ignore a value we cannot parse.
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  return [value, update];
}
