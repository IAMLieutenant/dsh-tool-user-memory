/**
 * Read-modify-write safety for the memory documents.
 *
 * Two layers are needed because several processes share one `$DSH_HOME`: the
 * desktop application, a `dsh web` server, and a headless run can all be open
 * at once, and within one process the agent may issue concurrent tool calls.
 *
 *   1. an in-process promise chain per lock path, so concurrent writers in one
 *      process never interleave their read, modify and write steps;
 *   2. an exclusive lock file, so two processes cannot clobber each other.
 *
 * The lock file is created with the `wx` flag, which fails atomically when the
 * path already exists. It is written and closed immediately rather than held
 * open, so Windows can unlink it on release. A lock file older than `staleMs`
 * is treated as abandoned, which covers a process that died mid-operation.
 *
 * Without this, two writers each read the old document, each merge their own
 * change, and the later write silently discards the earlier one: both callers
 * are told they succeeded while one update is gone.
 */

import { promises as fsp } from 'node:fs';
import * as nodePath from 'node:path';

export interface LockOptions {
  /** Give up after this long and report a busy document. */
  timeoutMs?: number;
  /** Delay between acquisition attempts. */
  retryMs?: number;
  /** A lock file older than this is treated as abandoned. */
  staleMs?: number;
}

export const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
export const DEFAULT_LOCK_RETRY_MS = 25;
export const DEFAULT_LOCK_STALE_MS = 30_000;

/** The document stayed locked by another process for the whole timeout. */
export class LockTimeoutError extends Error {
  readonly lockPath: string;
  readonly timeoutMs: number;

  constructor(lockPath: string, timeoutMs: number) {
    super(`timed out after ${timeoutMs} ms waiting for the lock at ${lockPath}`);
    this.name = 'LockTimeoutError';
    this.lockPath = lockPath;
    this.timeoutMs = timeoutMs;
  }
}

/** Test seam: the sleep used between acquisition attempts. */
let sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Replace the sleep implementation; returns a restore function. */
export function setLockSleep(next: (ms: number) => Promise<void>): () => void {
  const previous = sleep;
  sleep = next;
  return () => {
    sleep = previous;
  };
}

const chains = new Map<string, Promise<unknown>>();

/**
 * Serialize operations per key inside this process. The chain never rejects,
 * so one failed operation cannot poison the writers queued behind it.
 */
export function withProcessLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = chains.get(key);
  const result = previous === undefined ? operation() : previous.then(operation, operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return result;
}

/** Serialize one read-modify-write cycle in this process and across processes. */
export async function withDocumentLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  return withProcessLock(lockPath, async () => {
    await acquireLock(lockPath, options);
    try {
      return await operation();
    } finally {
      await fsp.unlink(lockPath).catch(() => undefined);
    }
  });
}

async function acquireLock(lockPath: string, options: LockOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_LOCK_RETRY_MS;
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  await fsp.mkdir(nodePath.dirname(lockPath), { recursive: true, mode: 0o700 }).catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  let reclaimAttempted = false;

  for (;;) {
    try {
      const handle = await fsp.open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`, 'utf8').catch(() => undefined);
      await handle.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    // Someone holds it. Reclaim the lock once, and only when it looks abandoned.
    if (!reclaimAttempted) {
      reclaimAttempted = true;
      const held = await fsp.stat(lockPath).catch(() => undefined);
      if (held !== undefined && Date.now() - held.mtimeMs > staleMs) {
        await fsp.unlink(lockPath).catch(() => undefined);
        continue;
      }
    }

    if (Date.now() >= deadline) throw new LockTimeoutError(lockPath, timeoutMs);
    await sleep(retryMs);
  }
}
