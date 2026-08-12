import changelog from "../../CHANGELOG.md?raw";

export interface ChangelogSection {
  heading: string;
  entries: string[];
}

/**
 * Pull one release out of CHANGELOG.md.
 *
 * The changelog is bundled rather than fetched from the release notes, so the
 * panel also works for someone who installed manually instead of updating in
 * place — and there is only one place to keep the text.
 */
export function changesFor(version: string): ChangelogSection[] {
  const start = changelog.indexOf(`## [${version}]`);
  if (start === -1) return [];

  const rest = changelog.slice(start);
  const end = rest.indexOf("\n## [", 1);
  const body = end === -1 ? rest : rest.slice(0, end);

  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;

  for (const rawLine of body.split("\n").slice(1)) {
    const line = rawLine.trimEnd();

    if (line.startsWith("### ")) {
      current = { heading: line.slice(4).trim(), entries: [] };
      sections.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith("- ")) {
      current.entries.push(line.slice(2).trim());
    } else if (line.startsWith("  ") && current.entries.length > 0) {
      // Continuation of the previous bullet, which wraps across lines.
      current.entries[current.entries.length - 1] += ` ${line.trim()}`;
    }
  }

  return sections.filter((section) => section.entries.length > 0);
}

/** Render the tiny subset of markdown the changelog uses: **bold** and `code`. */
export function renderInline(text: string): { text: string; bold: boolean; code: boolean }[] {
  const parts: { text: string; bold: boolean; code: boolean }[] = [];
  const pattern = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), bold: false, code: false });
    }
    parts.push({
      text: match[1] ?? match[2],
      bold: Boolean(match[1]),
      code: Boolean(match[2]),
    });
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push({ text: text.slice(last), bold: false, code: false });
  }
  return parts;
}
