/**
 * User-memory profile: pure document helpers (no I/O, no harness imports).
 *
 * Storage format is a small Markdown document:
 *
 *   # User Memory
 *
 *   ## <key>
 *   <!-- ts: <ISO 8601> -->
 *   <value lines>
 *
 * A value line whose first character is `#`, `\`, or `<` is written with a
 * leading `\` escape, so a value can never be misread as a `## <key>` heading
 * or an `<!-- ts:` metadata line. `parseProfile` / `serializeProfile` round-trip
 * exactly. Every mutation goes through `mergeEntry`, so behaviour is
 * unit-testable without a host.
 */

export interface ProfileEntry {
  key: string;
  value: string;
  /** ISO 8601 timestamp of the last update; '' for hand-edited entries (treated as oldest). */
  updatedAt: string;
}

export type MergeMode = 'set' | 'append' | 'remove';

/** Keys managed by the plugin itself; tools must reject writes to them. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['updated-at']);

const TS_PREFIX = '<!-- ts: ';
const TS_SUFFIX = ' -->';
const ESCAPE_FIRST: ReadonlySet<string> = new Set(['#', '\\', '<']);

/** Validate a user-supplied key (already trimmed) before writing it. */
export function validateKey(key: string): string | null {
  if (key === '') return 'key must be a non-empty string';
  if (key.length > 128) return 'key must be at most 128 characters';
  if (/[\r\n]/.test(key)) return 'key must be a single line';
  return null;
}

function escapeLine(line: string): string {
  return ESCAPE_FIRST.has(line[0] ?? '') ? `\\${line}` : line;
}

function unescapeLine(line: string): string {
  return line.startsWith('\\') ? line.slice(1) : line;
}

/** Parse a profile document into ordered entries (reserved keys included). */
export function parseProfile(doc: string): ProfileEntry[] {
  const entries: ProfileEntry[] = [];
  let current: ProfileEntry | null = null;
  for (const rawLine of doc.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(rawLine);
    if (heading) {
      if (current) entries.push(current);
      current = { key: heading[1]!.trim(), value: '', updatedAt: '' };
    } else if (current) {
      if (rawLine.startsWith('\\')) {
        current.value += (current.value === '' ? '' : '\n') + unescapeLine(rawLine);
      } else if (
        rawLine.startsWith(TS_PREFIX) &&
        rawLine.endsWith(TS_SUFFIX) &&
        current.updatedAt === ''
      ) {
        current.updatedAt = rawLine.slice(TS_PREFIX.length, rawLine.length - TS_SUFFIX.length);
      } else if (rawLine.trim() !== '') {
        current.value += (current.value === '' ? '' : '\n') + rawLine.trimStart();
      }
    }
  }
  if (current) entries.push(current);
  return entries;
}

/** Serialize entries back into the canonical document (reserved keys dropped). */
export function serializeProfile(entries: ProfileEntry[]): string {
  const lines = ['# User Memory'];
  for (const { key, value, updatedAt } of entries) {
    if (key === '' || RESERVED_KEYS.has(key)) continue;
    lines.push('', `## ${key}`);
    if (updatedAt !== '') lines.push(`${TS_PREFIX}${updatedAt}${TS_SUFFIX}`);
    if (value !== '') lines.push(...value.split(/\r?\n/).map(escapeLine));
  }
  return lines.join('\n') + '\n';
}

/** Apply one update to an entry list, returning a new list (immutable). */
export function mergeEntry(
  entries: ProfileEntry[],
  key: string,
  value: string,
  mode: MergeMode,
  now: string,
): ProfileEntry[] {
  const trimmedKey = key.trim();
  const error = validateKey(trimmedKey);
  if (error) throw new Error(`memory_update: ${error}`);
  const index = entries.findIndex((entry) => entry.key === trimmedKey);
  if (mode === 'remove') return entries.filter((entry) => entry.key !== trimmedKey);
  const mergedValue =
    mode === 'append' && index >= 0 && entries[index]!.value !== ''
      ? `${entries[index]!.value}\n${value}`
      : value;
  const updated: ProfileEntry = { key: trimmedKey, value: mergedValue, updatedAt: now };
  if (index >= 0) {
    const copy = entries.slice();
    copy[index] = updated;
    return copy;
  }
  return [...entries, updated];
}

/** Sort newest-first by `updatedAt` (empty timestamps sort last, as oldest). */
export function orderByRecency(entries: ProfileEntry[]): ProfileEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      if (a.entry.updatedAt !== b.entry.updatedAt) {
        return a.entry.updatedAt < b.entry.updatedAt ? 1 : -1;
      }
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/** Render entries as model-facing markdown (reserved keys excluded). */
export function renderEntries(entries: ProfileEntry[]): string {
  if (entries.length === 0) return '';
  const lines: string[] = [];
  for (const { key, value } of entries) {
    if (RESERVED_KEYS.has(key)) continue;
    lines.push(`## ${key}`, value === '' ? '(empty)' : value, '');
  }
  return lines.join('\n').trimEnd();
}

/**
 * Render entries newest-first within a byte budget, never splitting an entry.
 * The newest entry is always included even if it alone exceeds the budget, so a
 * single large preference is never hidden. Returns how many entries were left
 * out, so the caller can point at the full profile.
 */
export function renderEntriesBudgeted(
  entries: ProfileEntry[],
  maxBytes: number,
): { text: string; omitted: number } {
  const ordered = orderByRecency(entries.filter((entry) => !RESERVED_KEYS.has(entry.key)));
  if (ordered.length === 0) return { text: '', omitted: 0 };
  const out: ProfileEntry[] = [ordered[0]!];
  for (let i = 1; i < ordered.length; i += 1) {
    out.push(ordered[i]!);
    if (byteLength(renderEntries(out)) > maxBytes) {
      out.pop();
      break;
    }
  }
  return { text: renderEntries(out), omitted: ordered.length - out.length };
}

export interface Eviction {
  kept: ProfileEntry[];
  evicted: string[];
  /** Key of the single surviving entry whose value was truncated to fit, if any. */
  truncated: string | null;
}

/**
 * Drop whole entries (oldest first, by `updatedAt`; missing timestamps count as
 * oldest) until the serialized document fits `budgetBytes`. If a single entry
 * still exceeds the budget it is never dropped — its value is head-truncated
 * with a visible marker instead. Returns the dropped keys and any truncated key.
 */
export function evictToBudget(entries: ProfileEntry[], budgetBytes: number): Eviction {
  let kept = entries.slice();
  const evicted: string[] = [];
  let truncated: string | null = null;

  while (byteLength(serializeProfile(kept)) > budgetBytes && kept.length > 1) {
    let oldest = 0;
    for (let i = 1; i < kept.length; i += 1) {
      if (kept[i]!.updatedAt < kept[oldest]!.updatedAt) oldest = i;
    }
    evicted.push(kept[oldest]!.key);
    kept = kept.filter((_, i) => i !== oldest);
  }

  if (kept.length === 1 && byteLength(serializeProfile(kept)) > budgetBytes) {
    const entry = kept[0]!;
    // The value contributes its own bytes plus one trailing newline on top of
    // the entry's fixed heading + timestamp lines.
    const fixed = byteLength(serializeProfile([{ ...entry, value: '' }])) + 1;
    const valueBudget = Math.max(0, budgetBytes - fixed);
    kept = [{ ...entry, value: truncateValue(entry.value, valueBudget) }];
    truncated = entry.key;
  }

  return { kept, evicted, truncated };
}

/** Head-truncate a value to `maxBytes` with a visible marker. */
function truncateValue(value: string, maxBytes: number): string {
  const marker = '… [truncated]';
  if (maxBytes <= 0) return '';
  if (byteLength(value) <= maxBytes) return value;
  const budget = maxBytes - byteLength(marker);
  if (budget <= 0) return marker.slice(0, maxBytes);
  return takeChars(value, budget) + marker;
}

function takeChars(text: string, maxBytes: number): string {
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > maxBytes) break;
    out += ch;
    bytes += size;
  }
  return out;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
