/**
 * User-memory profile: pure document helpers (no I/O, no harness imports).
 *
 * Storage format is a small Markdown document:
 *
 *   # User Memory
 *
 *   ## <key>
 *   <value lines>
 *
 * `parseProfile` / `serializeProfile` are round-trip idempotent; every mutation
 * goes through `mergeEntry`, so behaviour is unit-testable without a host.
 */

export interface ProfileEntry {
  key: string;
  value: string;
}

export type MergeMode = 'set' | 'append' | 'remove';

/** Keys managed by the plugin itself; tools must reject writes to them. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['updated-at']);

/** Parse a profile document into ordered entries (reserved keys included). */
export function parseProfile(doc: string): ProfileEntry[] {
  const entries: ProfileEntry[] = [];
  let current: ProfileEntry | null = null;
  for (const rawLine of doc.split(/\r?\n/)) {
    const match = /^##\s+(.+?)\s*$/.exec(rawLine);
    if (match) {
      if (current) entries.push(current);
      current = { key: match[1]!.trim(), value: '' };
    } else if (current && rawLine.trim() !== '') {
      current.value += (current.value === '' ? '' : '\n') + rawLine.trimStart();
    }
  }
  if (current) entries.push(current);
  return entries;
}

/** Serialize entries back into the canonical document shape (reserved keys dropped). */
export function serializeProfile(entries: ProfileEntry[]): string {
  const lines = ['# User Memory'];
  for (const { key, value } of entries) {
    if (key === '' || RESERVED_KEYS.has(key)) continue;
    lines.push('', `## ${key}`);
    if (value !== '') lines.push(...value.split(/\r?\n/));
  }
  return lines.join('\n') + '\n';
}

/** Apply one update to an entry list, returning a new list (immutable). */
export function mergeEntry(entries: ProfileEntry[], key: string, value: string, mode: MergeMode): ProfileEntry[] {
  const trimmedKey = key.trim();
  if (trimmedKey === '') throw new Error('memory_update: key must be a non-empty string');
  const index = entries.findIndex((entry) => entry.key === trimmedKey);
  if (mode === 'remove') {
    return entries.filter((entry) => entry.key !== trimmedKey);
  }
  if (mode === 'append') {
    const previous = index >= 0 ? entries[index]!.value : '';
    const merged = previous === '' ? value : `${previous}\n${value}`;
    if (index >= 0) {
      const copy = entries.slice();
      copy[index] = { key: trimmedKey, value: merged };
      return copy;
    }
    return [...entries, { key: trimmedKey, value: merged }];
  }
  // 'set' (default)
  if (index >= 0) {
    const copy = entries.slice();
    copy[index] = { key: trimmedKey, value };
    return copy;
  }  return [...entries, { key: trimmedKey, value }];
}

/** Trim a document to maxBytes, keeping head and tail. UTF-8 byte aware. */
export function truncateBytes(doc: string, maxBytes: number): string {
  if (byteLength(doc) <= maxBytes) return doc;
  const footer = '\n\n<!-- truncated: profile exceeds configured limit -->\n';
  const half = Math.max(1, Math.floor((maxBytes - byteLength(footer)) / 2));
  const head = takeChars(doc, half);
  const tail = takeCharsReversed(doc, half);
  return `${head}\n\n... [truncated] ...\n\n${tail}${footer}`;
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

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
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

function takeCharsReversed(text: string, maxBytes: number): string {
  const chars = [...text];
  let out = '';
  let bytes = 0;
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const ch = chars[i]!;
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > maxBytes) break;
    out = ch + out;
    bytes += size;
  }
  return out;
}
