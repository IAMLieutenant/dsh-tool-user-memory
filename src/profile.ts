/**
 * User-memory profile: pure document helpers (no I/O, no harness imports).
 *
 * Storage format is a small Markdown document:
 *
 *   # User Memory
 *
 *   ## <key>
 *   <!-- ts: <ISO 8601> -->
 *   <!-- invalid: <ISO 8601> | <reason> -->   (optional: soft-invalidation)
 *   <value lines>
 *
 * A value line whose first character is `#`, `\`, or `<` is written with a
 * leading `\` escape, so a value can never be misread as a `## <key>` heading
 * or an `<!-- ts:` / `<!-- invalid:` metadata line. `parseProfile` /
 * `serializeProfile` round-trip exactly. Every mutation goes through
 * `mergeEntry`, so behaviour is unit-testable without a host.
 *
 * Temporal semantics: `invalidate` soft-deletes an entry (value kept for
 * audit, hidden from the prompt and from `memory_get` unless asked);
 * `set`/`append` on an invalidated key revives it. `isStale` flags entries
 * not updated within a configured number of days (annotation only).
 */

export interface ProfileEntry {
  key: string;
  value: string;
  /** ISO 8601 timestamp of the last update; '' for hand-edited entries (treated as oldest). */
  updatedAt: string;
  /** ISO 8601 timestamp when the entry was invalidated; '' = still valid. */
  invalidatedAt: string;
  /** Why the entry was invalidated ('' when valid, or when no reason was given). */
  invalidReason: string;
  /** Optional user-controlled retention priority; absent means unpinned. */
  pinned?: boolean;
}

export type MergeMode = 'set' | 'append' | 'remove' | 'invalidate';

/** Keys managed by the plugin itself; tools must reject writes to them. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['updated-at']);

const TS_PREFIX = '<!-- ts: ';
const TS_SUFFIX = ' -->';
const INVALID_PREFIX = '<!-- invalid: ';
const INVALID_SUFFIX = ' -->';
const ESCAPE_FIRST: ReadonlySet<string> = new Set(['#', '\\', '<']);
const REASON_MAX_CHARS = 200;
const PIN_PREFIX = '<!-- pinned-keys: ';

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
  let pinnedKeys: string[] | null = null;
  for (const rawLine of doc.split(/\r?\n/)) {
    // Preamble metadata is ignored by legacy readers, never mistaken for a value.
    if (!current && rawLine.startsWith(PIN_PREFIX)) {
      if (pinnedKeys !== null || !rawLine.endsWith(TS_SUFFIX)) throw new Error('置顶元数据格式无效，保存已停止；请从历史快照恢复');
      try {
        const keys = JSON.parse(decodeURIComponent(rawLine.slice(PIN_PREFIX.length, -TS_SUFFIX.length)));
        if (!Array.isArray(keys) || !keys.every(k => typeof k === 'string' && !validateKey(k) && !RESERVED_KEYS.has(k))) throw new Error();
        pinnedKeys = keys;
      } catch { throw new Error('置顶元数据格式无效，保存已停止；请从历史快照恢复'); }
      continue;
    }
    const heading = /^##\s+(.+?)\s*$/.exec(rawLine);
    if (heading) {
      if (current) entries.push(current);
      current = { key: heading[1]!.trim(), value: '', updatedAt: '', invalidatedAt: '', invalidReason: '' };
    } else if (current) {
      if (rawLine.startsWith('\\')) {
        current.value += (current.value === '' ? '' : '\n') + unescapeLine(rawLine);
      } else if (
        rawLine.startsWith(TS_PREFIX) &&
        rawLine.endsWith(TS_SUFFIX) &&
        current.updatedAt === ''
      ) {
        current.updatedAt = rawLine.slice(TS_PREFIX.length, rawLine.length - TS_SUFFIX.length);
      } else if (
        rawLine.startsWith(INVALID_PREFIX) &&
        rawLine.endsWith(INVALID_SUFFIX) &&
        current.invalidatedAt === ''
      ) {
        const payload = rawLine.slice(INVALID_PREFIX.length, rawLine.length - INVALID_SUFFIX.length);
        const sep = payload.indexOf('|');
        current.invalidatedAt = (sep >= 0 ? payload.slice(0, sep) : payload).trim();
        current.invalidReason = sep >= 0 ? payload.slice(sep + 1).trim() : '';
      } else if (rawLine.trim() !== '') {
        current.value += (current.value === '' ? '' : '\n') + rawLine.trimStart();
      }
    }
  }
  if (current) entries.push(current);
  for (const entry of entries) if (pinnedKeys?.includes(entry.key)) entry.pinned = true;
  return entries;
}

/** Serialize entries back into the canonical document (reserved keys dropped). */
export function serializeProfile(entries: ProfileEntry[]): string {
  const lines = ['# User Memory'];
  const pins = entries.filter(e => e.pinned && e.key && !RESERVED_KEYS.has(e.key)).map(e => e.key);
  if (pins.length) lines.push(`${PIN_PREFIX}${encodeURIComponent(JSON.stringify(pins))}${TS_SUFFIX}`);
  for (const { key, value, updatedAt, invalidatedAt, invalidReason } of entries) {
    if (key === '' || RESERVED_KEYS.has(key)) continue;
    lines.push('', `## ${key}`);
    if (updatedAt !== '') lines.push(`${TS_PREFIX}${updatedAt}${TS_SUFFIX}`);
    if (invalidatedAt) {
      lines.push(
        `${INVALID_PREFIX}${invalidatedAt}${invalidReason ? ` | ${invalidReason}` : ''}${INVALID_SUFFIX}`,
      );
    }
    if (value !== '') lines.push(...value.split(/\r?\n/).map(escapeLine));
  }
  return lines.join('\n') + '\n';
}

/** Sanitize an invalidation reason: first line, trimmed, length-capped. */
function sanitizeReason(reason: string): string {
  return reason.split(/\r?\n/)[0]!.trim().slice(0, REASON_MAX_CHARS);
}

/** Apply one update to an entry list, returning a new list (immutable). */
export function mergeEntry(
  entries: ProfileEntry[],
  key: string,
  value: string,
  mode: MergeMode,
  now: string,
  invalidateReason = '',
): ProfileEntry[] {
  const trimmedKey = key.trim();
  const error = validateKey(trimmedKey);
  if (error) throw new Error(`memory_update: ${error}`);
  const index = entries.findIndex((entry) => entry.key === trimmedKey);
  if (mode === 'remove') return entries.filter((entry) => entry.key !== trimmedKey);
  if (mode === 'invalidate') {
    if (index < 0) {
      throw new Error(`memory_update: cannot invalidate unknown key '${trimmedKey}'`);
    }
    const target = entries[index]!;
    const updated: ProfileEntry = {
      ...target,
      invalidatedAt: now,
      invalidReason: sanitizeReason(invalidateReason),
    };
    const copy = entries.slice();
    copy[index] = updated;
    return copy;
  }
  const existing = index >= 0 ? entries[index]! : null;
  const mergedValue =
    mode === 'append' && existing !== null && existing.value !== ''
      ? `${existing.value}\n${value}`
      : value;
  // set/append revalidate the key: any previous invalidation is cleared.
  const updated: ProfileEntry = {
    ...(existing?.pinned ? { pinned: true } : {}),
    key: trimmedKey,
    value: mergedValue,
    updatedAt: now,
    invalidatedAt: '',
    invalidReason: '',
  };
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

/** Pinned entries precede other entries; recency resolves priority ties. */
export function orderByPriority(entries: ProfileEntry[]): ProfileEntry[] {
  return orderByRecency(entries).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
}

/** Options for freshness-aware rendering (all optional; defaults = no annotation). */
export interface RenderOptions {
  /** ISO "now" used for age math; defaults to the real current time. */
  now?: string;
  /** When > 0, entries not updated within this many days get a [stale] annotation. */
  staleAfterDays?: number;
}

const DAY_MS = 86_400_000;

/** True when the entry is valid but not updated within `staleAfterDays` days. */
export function isStale(entry: ProfileEntry, now: string, staleAfterDays: number): boolean {
  if (staleAfterDays <= 0) return false;
  const baseMs = Date.parse(entry.updatedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(baseMs) || Number.isNaN(nowMs)) return false;
  return nowMs - baseMs > staleAfterDays * DAY_MS;
}

function entryHeading(entry: ProfileEntry, now: string, staleAfterDays: number): string {
  if (entry.invalidatedAt) {
    const stamp = entry.invalidatedAt.slice(0, 10);
    const reason = (entry.invalidReason ?? '').trim();
    return `## ${entry.key} [invalidated ${stamp}${reason !== '' ? `: ${reason}` : ''}]`;
  }
  if (staleAfterDays > 0 && isStale(entry, now, staleAfterDays)) {
    const ageDays = Math.floor((Date.parse(now) - Date.parse(entry.updatedAt)) / DAY_MS);
    return `## ${entry.key} [stale: last updated ${ageDays}d ago]`;
  }
  return `## ${entry.key}`;
}

/** Render entries as model-facing markdown (reserved keys excluded). */
export function renderEntries(entries: ProfileEntry[], options: RenderOptions = {}): string {
  if (entries.length === 0) return '';
  const now = options.now ?? new Date().toISOString();
  const staleAfterDays = options.staleAfterDays ?? 0;
  const lines: string[] = [];
  for (const entry of entries) {
    if (RESERVED_KEYS.has(entry.key)) continue;
    lines.push(entryHeading(entry, now, staleAfterDays), entry.value === '' ? '(empty)' : entry.value, '');
  }
  return lines.join('\n').trimEnd();
}

/**
 * Render entries newest-first within a byte budget. Keep whole entries when
 * they fit; visibly truncate an oversized newest entry. Return how many entries
 * were left out so the caller can point at the full profile.
 */
export function renderEntriesBudgeted(
  entries: ProfileEntry[],
  maxBytes: number,
  options: RenderOptions = {},
): { text: string; omitted: number } {
  const ordered = orderByPriority(entries.filter((entry) => !RESERVED_KEYS.has(entry.key)));
  if (ordered.length === 0) return { text: '', omitted: 0 };
  const out: ProfileEntry[] = [ordered[0]!];
  const first = renderEntries(out, options);
  if (byteLength(first) > maxBytes) {
    return { text: truncateText(first, Math.max(0, maxBytes)), omitted: ordered.length - 1 };
  }
  for (let i = 1; i < ordered.length; i += 1) {
    out.push(ordered[i]!);
    if (byteLength(renderEntries(out, options)) > maxBytes) {
      out.pop();
      break;
    }
  }
  return { text: renderEntries(out, options), omitted: ordered.length - out.length };
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
  const pinned = kept.filter(e => e.pinned);
  if (pinned.length && byteLength(serializeProfile(pinned)) > budgetBytes) {
    throw new Error('置顶记忆超过容量，保存已取消；请缩短置顶内容、取消部分置顶或提高 maxBytes');
  }

  while (byteLength(serializeProfile(kept)) > budgetBytes && kept.length > 1) {
    // Invalidated entries are dead weight: evict them before any live entry,
    // then by oldest updatedAt.
    let oldest = kept.findIndex(e => !e.pinned);
    if (oldest < 0) break;
    for (let i = 0; i < kept.length; i += 1) {
      const candidate = kept[i]!;
      if (candidate.pinned) continue;
      const incumbent = kept[oldest]!;
      const candidateDead = candidate.invalidatedAt !== '';
      const incumbentDead = incumbent.invalidatedAt !== '';
      if (candidateDead !== incumbentDead) {
        if (candidateDead) oldest = i;
      } else if (candidate.updatedAt < incumbent.updatedAt) {
        oldest = i;
      }
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
    let available = valueBudget;
    kept = [{ ...entry, value: truncateText(entry.value, available) }];
    // Escaping #, < and backslash adds bytes to the persisted representation.
    while (byteLength(serializeProfile(kept)) > budgetBytes && available > 0) {
      available = Math.max(0, available - (byteLength(serializeProfile(kept)) - budgetBytes));
      kept = [{ ...entry, value: truncateText(entry.value, available) }];
    }
    truncated = entry.key;
  }

  return { kept, evicted, truncated };
}

/** Head-truncate a value to `maxBytes` with a visible marker. */
export function truncateText(value: string, maxBytes: number): string {
  const marker = '… [truncated]';
  if (maxBytes <= 0) return '';
  if (byteLength(value) <= maxBytes) return value;
  const budget = maxBytes - byteLength(marker);
  if (budget <= 0) return takeChars(marker, maxBytes);
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
