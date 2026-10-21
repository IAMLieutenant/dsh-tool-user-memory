/**
 * Workspace memory layer: per-project memory as Markdown topic files under
 * `$DSH_HOME/user-memory/workspace/<hash>/`, plus a regenerable MEMORY.md
 * index (lazy-load pattern: the index is small enough to inject, topic bodies
 * are fetched on demand via `memory_search` / `memory_topic`).
 *
 * Layout for one workspace (hash = first 16 hex of sha256 over the
 * canonical project path, folded to lowercase only on Windows):
 *
 *   MEMORY.md            # human-readable index, regenerated on every write
 *   <topic>.md           # one topic per file (filename = topic name + .md)
 *
 * Topic file format (same escape discipline as the global profile):
 *
 *   # <topic>
 *   <!-- ts: <ISO 8601> -->
 *   <!-- invalid: <ISO 8601> | <reason> -->   (optional: soft-invalidation)
 *   <body lines, leading #, \, < escaped>
 *
 * Invalidated topics stay in the directory for audit but leave the index,
 * the prompt, and the default search results — same semantics as the
 * global profile.
 */

import { createHash } from 'node:crypto';
import { promises as fsp, readFileSync, realpathSync, readdirSync, existsSync } from 'node:fs';
import * as nodePath from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { withDocumentLock } from './lock.ts';
import { recordHistory, readMemoryDocument, documentHash } from './history.ts';

/**
 * Canonicalize a directory path: `..`/trailing slashes/symlinks resolved, and
 * on Windows the on-disk casing. Rejects (ENOENT) when the directory is gone —
 * the caller treats that as "no workspace". Deliberately local rather than
 * `@deepseek-ai/dsh-workspace`: only this one path helper is needed, and the
 * package root drags the whole durable registry in with it.
 */
async function canonicalDir(cwd: string): Promise<string> {
  return await fsp.realpath(nodePath.resolve(cwd));
}

export const TOPIC_MAX_BYTES = 16_384;

import { PROVENANCE_PREFIX, originLine, readOrigin, parseProvenance, type MemoryProvenance } from './provenance.ts';

export interface WorkspaceTopic {
  provenance?: MemoryProvenance;
  /** Topic name (the filename without .md; display name, case as written). */
  topic: string;
  body: string;
  /** ISO 8601 timestamp of the last update; '' for hand-edited files. */
  updatedAt: string;
  /** ISO 8601 timestamp when the topic was invalidated; '' = still valid. */
  invalidatedAt: string;
  /** Why the topic was invalidated ('' when valid, or when no reason given). */
  invalidReason: string;
}

export interface WorkspaceHit {
  topic: string;
  score: number;
  updatedAt: string;
  /** One-line excerpt around the first match (or the topic's first line). */
  snippet: string;
}

export type TopicMode = 'set' | 'append' | 'invalidate' | 'remove';

export interface TopicWriteResult {
  ok: boolean;
  topic: string;
  mode: TopicMode;
  error?: string;
}

/** Pure text helpers (no I/O): topic-file parsing, escaping, indexing, search. */

const TS_PREFIX = '<!-- ts: ';
const TS_SUFFIX = ' -->';
const INVALID_PREFIX = '<!-- invalid: ';
const INVALID_SUFFIX = ' -->';
const ESCAPE_FIRST = new Set(['#', '\\', '<']);
const FORBIDDEN_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/;
const TOPIC_MAX_NAME_CHARS = 64;

export function escapeLine(line: string): string {
  return ESCAPE_FIRST.has(line[0] ?? '') ? `\\${line}` : line;
}

export function unescapeLine(line: string): string {
  return line.startsWith('\\') ? line.slice(1) : line;
}

/** Validate + normalize a topic name for use as a filename stem. */
export function normalizeTopic(topic: string): { ok: true; topic: string } | { ok: false; error: string } {
  const t = topic.trim().replace(/\s+/g, ' ');
  if (t === '') return { ok: false, error: 'topic must be a non-empty string' };
  if (t.length > TOPIC_MAX_NAME_CHARS) return { ok: false, error: 'topic must be at most 64 characters' };
  if (t.startsWith('.')) return { ok: false, error: 'topic must not start with a dot' };
  if (t.toLowerCase() === 'memory') return { ok: false, error: 'MEMORY is reserved for the workspace index' };
  if (t.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(t)) {
    return { ok: false, error: 'topic must not use a reserved Windows filename or end with a dot' };
  }
  if (FORBIDDEN_FILENAME_CHARS.test(t)) {
    return { ok: false, error: 'topic must not contain filename-reserved characters (\\ / : * ? " < > |)' };
  }
  return { ok: true, topic: t };
}

/** Parse a topic file document into one WorkspaceTopic ('' body when empty). */
export function parseTopicFile(doc: string): WorkspaceTopic {
  let topic = '';
  let body = '';
  const parsed: WorkspaceTopic = {
    topic,
    body,
    updatedAt: '',
    invalidatedAt: '',
    invalidReason: '',
  };
  for (const rawLine of doc.split(/\r?\n/)) {
    if (rawLine.startsWith(PROVENANCE_PREFIX)) {
      if (parsed.provenance) throw new Error('重复的记忆来源');
      parsed.provenance = readOrigin(rawLine); continue;
    }
    const title = /^#\s+(.+?)\s*$/.exec(rawLine);
    if (title && parsed.topic === '') {
      parsed.topic = title[1]!.trim();
      continue;
    }
    if (
      parsed.updatedAt === '' &&
      rawLine.startsWith(TS_PREFIX) &&
      rawLine.endsWith(TS_SUFFIX)
    ) {
      parsed.updatedAt = rawLine.slice(TS_PREFIX.length, rawLine.length - TS_SUFFIX.length);
      continue;
    }
    if (
      parsed.invalidatedAt === '' &&
      rawLine.startsWith(INVALID_PREFIX) &&
      rawLine.endsWith(INVALID_SUFFIX)
    ) {
      const payload = rawLine.slice(INVALID_PREFIX.length, rawLine.length - INVALID_SUFFIX.length);
      const sep = payload.indexOf('|');
      parsed.invalidatedAt = (sep >= 0 ? payload.slice(0, sep) : payload).trim();
      parsed.invalidReason = sep >= 0 ? payload.slice(sep + 1).trim() : '';
      continue;
    }
    if (rawLine.trim() === '') continue;
    const line = rawLine.startsWith('\\') ? unescapeLine(rawLine) : rawLine.trimStart();
    parsed.body = parsed.body === '' ? line : `${parsed.body}\n${line}`;
  }
  return parsed;
}

/** Serialize a topic back into its canonical file document. */
export function serializeTopicFile(t: WorkspaceTopic): string {
  const lines = [`# ${t.topic}`];
  if (t.updatedAt !== '') lines.push(`${TS_PREFIX}${t.updatedAt}${TS_SUFFIX}`);
  if (t.provenance) lines.push(originLine(t.provenance));
  if (t.invalidatedAt !== '') {
    lines.push(
      `${INVALID_PREFIX}${t.invalidatedAt}${t.invalidReason !== '' ? ` | ${t.invalidReason}` : ''}${INVALID_SUFFIX}`,
    );
  }
  if (t.body !== '') lines.push(...t.body.split(/\r?\n/).map(escapeLine));
  return lines.join('\n') + '\n';
}

/**
 * Build the MEMORY.md index text from topics: valid topics only, newest first,
 * one summary line (the topic body's first line). `wsPath` is recorded in a
 * comment so the file stays human-locatable.
 */
export function buildIndexText(topics: WorkspaceTopic[], wsPath: string): string {
  const valid = topics
    .filter((t) => t.invalidatedAt === '')
    .slice()
    .sort(byRecency);
  const lines = ['# Workspace Memory', `<!-- ws: ${wsPath} -->`];
  for (const t of valid) {
    lines.push('', `## ${t.topic}`);
    if (t.updatedAt !== '') lines.push(`${TS_PREFIX}${t.updatedAt}${TS_SUFFIX}`);
    const first = t.body.split(/\r?\n/).find((l) => l.trim() !== '') ?? '(empty)';
    lines.push(first);
  }
  return lines.join('\n') + '\n';
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from <= haystack.length && (from = haystack.indexOf(needle, from)) !== -1) {
    count += 1;
    from += needle.length;
  }
  return count;
}

function makeSnippet(body: string, terms: readonly string[]): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat === '') return '(empty)';
  let best = -1;
  for (const term of terms) {
    const idx = flat.toLowerCase().indexOf(term);
    if (idx >= 0 && (best === -1 || idx < best)) best = idx;
  }
  if (best === -1) return flat.slice(0, 80);
  const start = Math.max(0, best - 30);
  const end = Math.min(flat.length, best + 60);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/**
 * Keyword-score topics: name matches weigh 3, body occurrences weigh 1 each
 * (capped at 5), a full-coverage bonus (all query terms matched) adds 4.
 * Substring-based, so unsegmented CJK queries still match. Empty query
 * returns every (valid, or all with `includeInvalidated`) topic with score 0
 * (newest first). Invalidated topics are excluded unless `includeInvalidated`
 * is set; then their snippets carry a `[invalidated ...]` marker.
 */
export function searchTopics(
  topics: WorkspaceTopic[],
  query: string,
  includeInvalidated = false,
): WorkspaceHit[] {
  const q = query.toLowerCase().trim();
  const pool = topics
    .filter((t) => includeInvalidated || t.invalidatedAt === '')
    .slice()
    .sort(byRecency);
  if (q === '') {
    return pool.map((t) => ({
      topic: t.topic,
      score: 0,
      updatedAt: t.updatedAt,
      snippet: markInvalidated(t, makeSnippet(t.body, [])),
    }));
  }
  const terms = q
    .split(/[\s,，;；。.!！?？:：/\\|()[\]{}"'`~—–-]+/)
    .filter((t) => t !== '')
    .slice(0, 8);
  const hits: WorkspaceHit[] = [];
  for (const t of pool) {
    const name = t.topic.toLowerCase();
    const body = t.body.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const inName = name.includes(term);
      const occ = countOccurrences(body, term);
      if (inName) score += 3;
      if (occ > 0) score += Math.min(occ, 5);
      if (inName || occ > 0) matched += 1;
    }
    if (terms.length > 1 && matched === terms.length) score += 4;
    if (score > 0) {
      hits.push({
        topic: t.topic,
        score,
        updatedAt: t.updatedAt,
        snippet: markInvalidated(t, makeSnippet(t.body, terms)),
      });
    }
  }
  return hits.sort(
    (a, b) =>
      b.score - a.score ||
      (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1),
  );
}

function markInvalidated(t: WorkspaceTopic, snippet: string): string {
  if (t.invalidatedAt === '') return snippet;
  const stamp = t.invalidatedAt.slice(0, 10);
  const reason = t.invalidReason.trim();
  return `[invalidated ${stamp}${reason !== '' ? `: ${reason}` : ''}] ${snippet}`;
}

/** I/O facade over one workspace's topic directory. */

export interface WorkspaceMemoryOptions {
  /** The session's working directory (canonicalized via realpath). */
  cwd: string;
  /** Base directory; defaults to $DSH_HOME/user-memory/workspace (test override). */
  baseDir?: string;
  mode?: WorkspaceMode;
  projectPath?: string;
}

export type WorkspaceMode = 'directory' | 'git-root';

/** Worktree .git files and ordinary .git directories both mark a repository root. */
export function projectDirectory(cwd: string, mode: WorkspaceMode = 'directory', override = ''): string {
  let current = realpathSync(nodePath.resolve(override.trim() || cwd));
  if (override.trim() || mode === 'directory') return current;
  if (mode !== 'git-root') throw new Error('invalid workspace mode');
  const original = current;
  while (true) {
    if (existsSync(nodePath.join(current, '.git'))) return current;
    const parent = nodePath.dirname(current);
    if (parent === current) return original;
    current = parent;
  }
}

/** Reuse an old Linux store only when its recorded source matches exactly. */
export function workspaceLocation(canonical: string, baseDir = ''): string {
  const base = baseDir || dshHomePath('user-memory', 'workspace');
  const target = nodePath.join(base, workspaceHashOf(canonical));
  if (process.platform === 'win32' || existsSync(target)) return target;
  const legacy = nodePath.join(base, workspaceHashOf(canonical.toLowerCase()));
  if (legacy === target) return target;
  try {
    const doc = readFileSync(nodePath.join(legacy, 'MEMORY.md'), 'utf8');
    if (/^<!-- ws: (.*?) -->$/m.exec(doc)?.[1] === canonical) return legacy;
  } catch { /* no unambiguous legacy store */ }
  return target;
}

export interface WorkspaceMemory {
  /** Canonical cwd the workspace identity was derived from. */
  path: string;
  /** Absolute directory holding this workspace's topic files. */
  dir: string;
  /** Every topic in the directory (invalidated included, file order). */
  list(): Promise<WorkspaceTopic[]>;
  /** One topic by name (undefined when missing); name matching is exact after normalize. */
  read(topic: string): Promise<WorkspaceTopic | undefined>;
  /** Apply one mutation and regenerate the index; never throws for policy errors. */
  write(topic: string, body: string, mode: TopicMode, invalidateReason?: string, expected?: WorkspaceTopic | null, dependency?: WorkspaceTopic, expectedDocumentHash?: string, provenance?: MemoryProvenance): Promise<TopicWriteResult>;
  /** Keyword-scored hits over valid topics (see `searchTopics`). */
  search(query: string): Promise<WorkspaceHit[]>;
  /** Regenerable index text (valid topics only). */
  indexText(): Promise<string>;
}

/** sha256 (hex, first 16 chars) over the lowercased realpath of `cwd`. */
export function workspaceHashOf(canonical: string, platform = process.platform): string {
  return createHash('sha256').update(platform === 'win32' ? canonical.toLowerCase() : canonical, 'utf8').digest('hex').slice(0, 16);
}

/** Resolve a session cwd to its workspace identity (directory + canonical path). */
export async function workspaceIdentity(cwd: string): Promise<{ dir: string; path: string }> {
  const canonical = await canonicalDir(cwd);
  return {
    dir: workspaceLocation(canonical),
    path: canonical,
  };
}

/** Read every topic file in a directory (sync; small, prompt-path use). */
export function readWorkspaceSync(dir: string): WorkspaceTopic[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const topics: WorkspaceTopic[] = [];
  for (const name of names) {
    if (!name.endsWith('.md') || name === 'MEMORY.md') continue;
    try {
      topics.push(parseTopicFile(readFileSync(nodePath.join(dir, name), 'utf8')));
    } catch {
      // A corrupt topic file must not break the prompt; skip it.
    }
  }
  return topics;
}

/**
 * Sync variant for the system-prompt path: resolve `cwd` to its workspace
 * directory and return the index text, or null when the cwd is missing,
 * has no memory, or the memory holds only invalidated topics. Never throws.
 */
export function readWorkspaceIndexSync(
  cwd: string,
  baseDir: string,
  mode: WorkspaceMode = 'directory',
  projectPath = '',
): { text: string; path: string } | null {
  let canonical: string;
  try {
    canonical = projectDirectory(cwd, mode, projectPath);
  } catch {
    return null;
  }
  const dir = workspaceLocation(canonical, baseDir);
  const topics = readWorkspaceSync(dir);
  if (!topics.some((t) => t.invalidatedAt === '')) return null;
  return { text: buildIndexText(topics, canonical), path: canonical };
}

/** Newest-first comparator that returns 0 on equal timestamps (stable sort). */
function byRecency(a: WorkspaceTopic, b: WorkspaceTopic): number {
  if (a.updatedAt === b.updatedAt) return 0;
  return a.updatedAt < b.updatedAt ? 1 : -1;
}

async function atomicWrite(dir: string, file: string, doc: string): Promise<void> {
  // `file` may be absolute or relative to `dir`; the temp name must stay a bare
  // filename (a Windows path contains ':' and cannot appear inside a filename).
  const target = nodePath.isAbsolute(file) ? file : nodePath.join(dir, file);
  const tmp = nodePath.join(dir, `.${nodePath.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  await fsp.writeFile(tmp, doc, { encoding: 'utf8', mode: 0o600 });
  try {
    await fsp.rename(tmp, target);
  } catch (error) {
    await fsp.unlink(tmp).catch(() => undefined);
    throw error;
  }
  await fsp.chmod(target, 0o600).catch(() => undefined);
}

async function listAsync(dir: string): Promise<WorkspaceTopic[]> {
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const topics: WorkspaceTopic[] = [];
  for (const name of names) {
    if (!name.endsWith('.md') || name === 'MEMORY.md') continue;
    try {
      const doc = await fsp.readFile(nodePath.join(dir, name), 'utf8');
      topics.push(parseTopicFile(doc));
    } catch {
      // skip corrupt files (same policy as the sync variant)
    }
  }
  return topics;
}

export async function createWorkspaceMemory(options: WorkspaceMemoryOptions): Promise<WorkspaceMemory> {
  const canonical = projectDirectory(options.cwd, options.mode, options.projectPath);
  const dir = workspaceLocation(canonical, options.baseDir);
  return createStoredWorkspaceMemory(dir, canonical);
}

/** Used by the manager for stored projects whose original directory no longer exists. */
export function createStoredWorkspaceMemory(dir: string, canonical: string): WorkspaceMemory {
  const path = canonical;

  async function rebuildIndex(topics: WorkspaceTopic[]): Promise<void> {
    await atomicWrite(dir, 'MEMORY.md', buildIndexText(topics, path));
  }

  async function findTopic(topic: string): Promise<WorkspaceTopic | undefined> {
    const norm = normalizeTopic(topic);
    if (!norm.ok) return undefined;
    const topics = await listAsync(dir);
    return (
      topics.find((t) => t.topic === norm.topic) ??
      topics.find((t) => t.topic.toLowerCase() === norm.topic.toLowerCase())
    );
  }

  return {
    path,
    dir,
    list: () => listAsync(dir),
    read: (topic) => findTopic(topic),
    indexText: async () => buildIndexText(await listAsync(dir), path),
    search: async (query) => searchTopics(await listAsync(dir), query),
    async write(topic, body, mode, invalidateReason = '', expected, dependency, expectedDocumentHash, provenance): Promise<TopicWriteResult> {
      const norm = normalizeTopic(topic);
      if (!norm.ok) return { ok: false, topic, mode, error: norm.error };
      const normalized = norm.topic;
      if (mode !== 'invalidate' && mode !== 'remove' && Buffer.byteLength(body, 'utf8') > TOPIC_MAX_BYTES) {
        return {
          ok: false,
          topic,
          mode,
          error: `topic body exceeds ${TOPIC_MAX_BYTES} bytes`,
        };
      }
      const now = new Date().toISOString();
      try {
        // One lock per workspace directory: a topic write also rebuilds the
        // shared MEMORY.md index, so serialization is per directory rather than
        // per topic file. The lock lives in that directory and is not a `.md`
        // file, so topic scanning ignores it.
        return await withDocumentLock<TopicWriteResult>(nodePath.join(dir, '.lock'), async () => {
          const topics = await listAsync(dir);
          const index = topics.findIndex(
            (t) => t.topic === normalized || t.topic.toLowerCase() === normalized.toLowerCase(),
          );
          const existing = index >= 0 ? topics[index]! : null;
          const unchanged = expected === undefined ||
            (expected === null ? existing === null : existing !== null &&
              existing.topic === expected.topic && existing.body === expected.body &&
              existing.updatedAt === expected.updatedAt && existing.invalidatedAt === expected.invalidatedAt &&
              existing.invalidReason === expected.invalidReason && JSON.stringify(existing.provenance) === JSON.stringify(expected.provenance));
          if (!unchanged) {
            return { ok: false, topic: normalized, mode, error: `topic '${normalized}' changed since the consolidation plan; skipped` };
          }
          if (dependency !== undefined) {
            const destination = topics.find((t) => t.topic === dependency.topic);
            if (destination === undefined || destination.body !== dependency.body ||
                destination.updatedAt !== dependency.updatedAt || destination.invalidatedAt !== dependency.invalidatedAt ||
                destination.invalidReason !== dependency.invalidReason) {
              return { ok: false, topic: normalized, mode, error: 'merge destination changed since the consolidation plan; skipped' };
            }
          }
          // Reuse the original spelling when a caller changes case, including
          // on case-sensitive filesystems.
          const storedName = existing?.topic ?? normalized;
          const file = nodePath.join(dir, `${storedName}.md`);
          if (expectedDocumentHash && documentHash(await readMemoryDocument(file)) !== expectedDocumentHash) return { ok: false, topic, mode, error: 'memory changed; refresh before editing' };
          if (mode === 'remove') {
            if (index >= 0) await recordHistory(file, await readMemoryDocument(file), null, 'remove');
            if (index >= 0) await fsp.unlink(file);
            await rebuildIndex(topics.filter((_, i) => i !== index));
            return { ok: true, topic: normalized, mode };
          }
          if (mode === 'invalidate') {
            if (index < 0) {
              return { ok: false, topic, mode, error: `topic '${normalized}' does not exist — nothing to invalidate` };
            }
            const target = topics[index]!;
            const updated: WorkspaceTopic = {
              ...target,
              invalidatedAt: now,
              invalidReason: invalidateReason.split(/\r?\n/)[0]!.trim().slice(0, 200),
            };
            await recordHistory(file, await readMemoryDocument(file), serializeTopicFile(updated), 'invalidate');
            await atomicWrite(dir, file, serializeTopicFile(updated));
            await rebuildIndex(topics.map((t, i) => (i === index ? updated : t)));
            return { ok: true, topic: normalized, mode };
          }
          const mergedBody =
            mode === 'append' && existing !== null && existing.body !== ''
              ? `${existing.body}\n${body}`
              : body;
          if (Buffer.byteLength(mergedBody, 'utf8') > TOPIC_MAX_BYTES) {
            return { ok: false, topic: normalized, mode, error: `combined topic body exceeds ${TOPIC_MAX_BYTES} bytes` };
          }
          const updated: WorkspaceTopic = {
            ...(provenance ? { provenance: parseProvenance(provenance) } : existing?.provenance ? { provenance: existing.body === mergedBody ? existing.provenance : { createdAt: existing.provenance.createdAt, method: 'tool' as const } } : {}),
            topic: storedName,
            body: mergedBody,
            updatedAt: now,
            invalidatedAt: '',
            invalidReason: '',
          };
          await recordHistory(file, await readMemoryDocument(file), serializeTopicFile(updated), mode);
          await atomicWrite(dir, file, serializeTopicFile(updated));
          const next = topics.slice();
          if (index >= 0) next[index] = updated;
          else next.push(updated);
          await rebuildIndex(next);
          return { ok: true, topic: normalized, mode };
        });
      } catch (error) {
        return { ok: false, topic, mode, error: String((error as Error).message ?? error) };
      }
    },
  };
}
