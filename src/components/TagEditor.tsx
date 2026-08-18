import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "./Icon";
import { setModTags } from "../lib/modActions";

/** Matches the backend's cap. Shown as a hint rather than enforced twice. */
const MAX_TAGS = 8;

/**
 * Free-form labels on a mod.
 *
 * Suggestions come from tags already in use rather than from a fixed list:
 * nobody agrees on how to categorise mods, and a preset vocabulary would be
 * wrong for most libraries. What matters is that the same tag typed twice is
 * one tag, which the backend guarantees by normalising on the way in.
 */
export function TagEditor({ modId, tags }: { modId: string; tags: string[] }) {
  const [draft, setDraft] = useState("");
  const [known, setKnown] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<string[]>("list_tags").then(setKnown).catch(() => setKnown([]));
  }, [tags]);

  const suggestions = useMemo(() => {
    const typed = draft.trim().toLowerCase();
    return known
      .filter(
        (tag) =>
          !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase()) &&
          (typed === "" || tag.toLowerCase().includes(typed))
      )
      .slice(0, 6);
  }, [known, tags, draft]);

  const add = (tag: string) => {
    const value = tag.trim();
    if (!value || tags.length >= MAX_TAGS) return;
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    setModTags(modId, [...tags, value]);
    setDraft("");
  };

  const remove = (tag: string) => setModTags(modId, tags.filter((t) => t !== tag));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="chip border-info/25 bg-info/10 !normal-case text-info"
          >
            {tag}
            <button
              onClick={() => remove(tag)}
              className="-mr-1 rounded p-0.5 hover:bg-info/20"
              aria-label={`Remove tag ${tag}`}
              title={`Remove ${tag}`}
            >
              <Icon name="close" size={11} strokeWidth={2.2} />
            </button>
          </span>
        ))}

        {tags.length < MAX_TAGS && (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
                remove(tags[tags.length - 1]);
              }
            }}
            onBlur={() => add(draft)}
            placeholder={tags.length === 0 ? "livery, 2026, testing…" : "Add another"}
            aria-label="Add a tag"
            className="input !w-36 !py-1 !text-xs"
          />
        )}
      </div>

      {suggestions.length > 0 && tags.length < MAX_TAGS && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-text-muted">Already used:</span>
          {suggestions.map((tag) => (
            <button key={tag} onClick={() => add(tag)} className="filter-chip !py-0.5 !text-2xs">
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
