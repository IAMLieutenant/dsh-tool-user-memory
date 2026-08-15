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
  update(key: string, value: string, mode: MergeMode): Promise<UpdateResult>;
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

  async function update(key: string, value: string, mode: MergeMode): Promise<UpdateResult> {
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
    const doc = await read();
    const merged = mergeEntry(parseDoc(doc), trimmedKey, value, mode, now);
    const stamp = `\n## updated-at\n${now}\n`;
    const budget = maxBytes - Buffer.byteLength(stamp, 'utf8');
    const { kept, evicted, truncated } = evictToBudget(merged, budget);
    const finalDoc = serializeProfile(kept) + stamp;
    await write(finalDoc);
    return {
      ok: true,
      key: trimmedKey,
      mode,
      bytes: Buffer.byteLength(finalDoc, 'utf8'),
      evicted,
      truncated,
    };
  }

  return { path: () => filePath, read, readSync, list, listSync, update };
}
