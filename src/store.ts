/**
 * Profile persistence: a single Markdown file under $DSH_HOME (global, shared
 * across workspaces), written atomically (tmp file + rename) with owner-only
 * permissions.
 *
 * This is plugin-internal trusted state (like dsh-settings-file or session
 * persistence), so it deliberately uses node:fs directly instead of the
 * sandboxed model-facing ctx.fs seam.
 */

import { promises as fsp, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { withDocumentLock } from './lock.ts';
import { archiveEntries, recordHistory, documentHash, readMemoryDocument } from './history.ts';
import {
  RESERVED_KEYS,
  evictToBudget,
  mergeEntry,
  parseProfile,
  serializeProfile,
  validateKey,
  type MergeMode,
  type ProfileEntry,
} from './profile.ts';

export const DEFAULT_MAX_BYTES = 8192;

export interface MemoryStoreOptions {
  /** Custom profile file path; defaults to $DSH_HOME/user-memory/user.md */
  path?: string;
  maxBytes: number;
}

export interface UpdateResult {
  ok: boolean;
  key: string;
  mode: MergeMode;
  bytes: number;
  /** Keys dropped to stay within `maxBytes` (oldest first). */
  evicted: string[];
  /** Key whose value was truncated because it alone exceeded the budget. */
  truncated: string | null;
  /** Complete entries removed from the active profile are retained here. */
  archivePath?: string | null;
  error?: string;
}

export interface MemoryStore {
  /** Absolute path of the profile file. */
  path(): string;
  /** Full document text ('' when the file does not exist yet). */
  read(): Promise<string>;
  /** Sync variant used by the system-prompt variable provider. */
  readSync(): string;
  /** Current entries (reserved keys excluded). */
  list(): Promise<ProfileEntry[]>;
  /** Sync variant used by the system-prompt variable provider. */
  listSync(): ProfileEntry[];
  update(key: string, value: string, mode: MergeMode, invalidateReason?: string, guard?: MemoryMutationGuard, pinned?: boolean): Promise<UpdateResult>;
  /** Change retention priority without refreshing content time or reactivating it. */
  setPinned(key: string, pinned: boolean, guard?: MemoryMutationGuard): Promise<UpdateResult>;
  /**
   * Replace an entry's value WITHOUT refreshing its updatedAt. An edit is not
   * a fresh confirmation, so the entry keeps its age.
   */
  rewrite(key: string, value: string, guard?: MemoryMutationGuard): Promise<UpdateResult>;
}

/** Checked inside the document lock, so an old plan cannot overwrite a newer fact. */
export interface MemoryMutationGuard {
  expected: ProfileEntry | null;
  expectedDocumentHash?: string;
  /** A merge may retire a source only while its destination still exists unchanged. */
  dependency?: ProfileEntry;
}

function guardError(current: ProfileEntry[], key: string, guard?: MemoryMutationGuard): string | null {
  if (guard === undefined) return null;
  const actual = current.find((entry) => entry.key === key) ?? null;
  const same = (a: ProfileEntry | null, b: ProfileEntry | null): boolean =>
    a === null || b === null ? a === b :
      a.key === b.key && a.value === b.value && a.updatedAt === b.updatedAt &&
      a.invalidatedAt === b.invalidatedAt && a.invalidReason === b.invalidReason && !!a.pinned === !!b.pinned;
  if (!same(actual, guard.expected)) {
    return `memory '${key}' changed since the consolidation plan; skipped`;
  }
  if (guard.dependency !== undefined) {
    const destination = current.find((entry) => entry.key === guard.dependency!.key) ?? null;
    if (!same(destination, guard.dependency)) {
      return `merge destination '${guard.dependency.key}' changed since the consolidation plan; skipped`;
    }
  }
  return null;
}

export function resolveProfilePath(override?: string): string {
  const trimmed = (override ?? '').trim();
  return trimmed === '' ? dshHomePath('user-memory', 'user.md') : trimmed;
}

export function createMemoryStore(options: MemoryStoreOptions): MemoryStore {
  const filePath = resolveProfilePath(options.path);
  const maxBytes =
    Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : DEFAULT_MAX_BYTES;

  async function read(): Promise<string> {
    try {
      return await fsp.readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  }

  function readSync(): string {
    try {
      return readFileSync(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  }

  async function write(doc: string): Promise<void> {
    await fsp.mkdir(nodePath.dirname(filePath), { recursive: true, mode: 0o700 });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmpPath, doc, { encoding: 'utf8', mode: 0o600 });
    try {
      await fsp.rename(tmpPath, filePath);
    } catch (error) {
      await fsp.unlink(tmpPath).catch(() => undefined);
      throw error;
    }
    // Best-effort on Windows (chmod is a no-op there).
    await fsp.chmod(filePath, 0o600).catch(() => undefined);
  }

  function parseDoc(doc: string): ProfileEntry[] {
    return parseProfile(doc).filter((entry) => !RESERVED_KEYS.has(entry.key));
  }

  async function list(): Promise<ProfileEntry[]> {
    return parseDoc(await read());
  }

  function listSync(): ProfileEntry[] {
    return parseDoc(readSync());
  }

  async function update(
    key: string,
    value: string,
    mode: MergeMode,
    invalidateReason = '',
    guard?: MemoryMutationGuard,
    pinned?: boolean,
  ): Promise<UpdateResult> {
    const trimmedKey = key.trim();
    const keyError = validateKey(trimmedKey);
    if (keyError) {
      return { ok: false, key, mode, bytes: 0, evicted: [], truncated: null, error: keyError };
    }
    if (RESERVED_KEYS.has(trimmedKey)) {
      return {
        ok: false,
        key,
        mode,
        bytes: 0,
        evicted: [],
        truncated: null,
        error: `key '${trimmedKey}' is reserved`,
      };
    }
    const now = new Date().toISOString();
    try {
      return await withDocumentLock<UpdateResult>(`${filePath}.lock`, async () => {
        const doc = await readMemoryDocument(filePath);
        if (guard?.expectedDocumentHash && documentHash(doc) !== guard.expectedDocumentHash) return failure(trimmedKey, mode, 'memory changed; refresh before editing');
        const current = parseDoc(doc ?? '');
        const conflict = guardError(current, trimmedKey, guard);
        if (conflict !== null) return failure(trimmedKey, mode, conflict);
        if (mode === 'invalidate' && !current.some((entry) => entry.key === trimmedKey)) {
          return {
            ok: false,
            key: trimmedKey,
            mode,
            bytes: 0,
            evicted: [],
            truncated: null,
            error: `key '${trimmedKey}' does not exist — nothing to invalidate`,
          };
        }
        const merged = mergeEntry(current, trimmedKey, value, mode, now, invalidateReason);
        if (pinned !== undefined) for (const entry of merged) if (entry.key === trimmedKey) {
          if (pinned) entry.pinned = true; else delete entry.pinned;
        }
        return await commit(merged, trimmedKey, mode, now);
      });
    } catch (error) {
      return failure(trimmedKey, mode, `write failed: ${describeError(error)}`);
    }
  }

  async function setPinned(key: string, pinned: boolean, guard?: MemoryMutationGuard): Promise<UpdateResult> {
    const trimmedKey = key.trim();
    if (validateKey(trimmedKey) || RESERVED_KEYS.has(trimmedKey)) return failure(key, 'set', '记忆名称无效');
    try {
      return await withDocumentLock(`${filePath}.lock`, async () => {
        const doc = await readMemoryDocument(filePath);
        if (guard?.expectedDocumentHash && documentHash(doc) !== guard.expectedDocumentHash) return failure(key, 'set', 'memory changed; refresh before editing');
        const current = parseDoc(doc ?? '');
        const conflict = guardError(current, trimmedKey, guard);
        if (conflict) return failure(key, 'set', conflict);
        if (!current.some(e => e.key === trimmedKey)) return failure(key, 'set', '记忆不存在，请重新打开管理窗口');
        const merged = current.map(e => {
          const copy = { ...e };
          if (copy.key === trimmedKey) { if (pinned) copy.pinned = true; else delete copy.pinned; }
          return copy;
        });
        return commit(merged, trimmedKey, 'set', new Date().toISOString(), `${pinned ? 'pin' : 'unpin'}:${trimmedKey}`);
      });
    } catch (error) { return failure(key, 'set', `write failed: ${describeError(error)}`); }
  }

  /**
   * Replace one entry's value WITHOUT refreshing its timestamp. Consolidation
   * uses this for content edits such as anchoring a relative date: an edit is
   * not a fresh confirmation, and letting it refresh `updatedAt` would silently
   * reset the entry's age, defeating `staleAfterDays` and
   * `autoInvalidateAfterDays`.
   */
  async function rewrite(key: string, value: string, guard?: MemoryMutationGuard): Promise<UpdateResult> {
    const trimmedKey = key.trim();
    const keyError = validateKey(trimmedKey);
    if (keyError) return failure(key, 'set', keyError);
    if (RESERVED_KEYS.has(trimmedKey)) {
      return failure(key, 'set', `key '${trimmedKey}' is reserved`);
    }
    const now = new Date().toISOString();
    try {
      return await withDocumentLock<UpdateResult>(`${filePath}.lock`, async () => {
        const doc = await readMemoryDocument(filePath);
        if (guard?.expectedDocumentHash && documentHash(doc) !== guard.expectedDocumentHash) return failure(trimmedKey, 'set', 'memory changed; refresh before editing');
        const current = parseDoc(doc ?? '');
        const conflict = guardError(current, trimmedKey, guard);
        if (conflict !== null) return failure(trimmedKey, 'set', conflict);
        const target = current.find((entry) => entry.key === trimmedKey);
        if (target === undefined) {
          return failure(trimmedKey, 'set', `key '${trimmedKey}' does not exist — nothing to rewrite`);
        }
        // A content edit preserves both age and invalidation; only explicit
        // set/append should revive a retired entry.
        const merged = current.map((entry) => entry.key === trimmedKey ? { ...entry, value } : entry);
        return await commit(merged, trimmedKey, 'set', now);
      });
    } catch (error) {
      return failure(trimmedKey, 'set', `write failed: ${describeError(error)}`);
    }
  }

  /** Apply the byte budget and write the document; shared by update and rewrite. */
  async function commit(
    merged: ProfileEntry[],
    key: string,
    mode: MergeMode,
    now: string,
    label = `${mode}:${key}`,
  ): Promise<UpdateResult> {
    const stamp = `\n## updated-at\n${now}\n`;
    const budget = maxBytes - Buffer.byteLength(stamp, 'utf8');
    const { kept, evicted, truncated } = evictToBudget(merged, budget);
    const finalDoc = serializeProfile(kept) + stamp;
    if (Buffer.byteLength(finalDoc, 'utf8') > maxBytes) {
      return failure(key, mode, 'maxBytes is too small for the profile metadata; nothing was written');
    }
    const before = await readMemoryDocument(filePath);
    await recordHistory(filePath, before, finalDoc, label);
    const archived = merged.filter(entry => evicted.includes(entry.key) || entry.key === truncated);
    const archivePath = await archiveEntries(filePath, archived);
    await write(finalDoc);
    return {
      ok: true,
      key,
      mode,
      bytes: Buffer.byteLength(finalDoc, 'utf8'),
      evicted,
      truncated,
      archivePath,
    };
  }

  return { path: () => filePath, read, readSync, list, listSync, update, rewrite, setPinned };
}

/** One structured failure shape, so every rejection path reports identically. */
function failure(key: string, mode: MergeMode, error: string): UpdateResult {
  return { ok: false, key, mode, bytes: 0, evicted: [], truncated: null, error };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
