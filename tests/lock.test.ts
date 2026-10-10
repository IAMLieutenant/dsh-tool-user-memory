/**
 * Lock primitive tests: in-process serialization, mutual exclusion, abandoned
 * lock recovery, and release on failure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LockTimeoutError, withDocumentLock, withProcessLock } from '../src/lock.ts';

test('withProcessLock serializes operations that would otherwise interleave', async () => {
  const order: string[] = [];
  const slow = withProcessLock('k', async () => {
    order.push('first:start');
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push('first:end');
    return 1;
  });
  const fast = withProcessLock('k', async () => {
    order.push('second:start');
    return 2;
  });
  assert.deepEqual(await Promise.all([slow, fast]), [1, 2]);
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start']);
});

test('withProcessLock does not let one failure poison the queue', async () => {
  await assert.rejects(
    withProcessLock('k2', async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(await withProcessLock('k2', async () => 'ok'), 'ok');
});

test('withDocumentLock never admits two holders at once, and releases afterwards', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lock-'));
  const lock = join(dir, 'doc.lock');
  try {
    let inside = 0;
    let maxInside = 0;
    const operation = (label: string) => async (): Promise<string> => {
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inside -= 1;
      return label;
    };
    const results = await Promise.all([
      withDocumentLock(lock, operation('a')),
      withDocumentLock(lock, operation('b')),
      withDocumentLock(lock, operation('c')),
    ]);
    assert.deepEqual(results, ['a', 'b', 'c']);
    assert.equal(maxInside, 1, 'mutual exclusion held');
    await assert.rejects(readFile(lock, 'utf8'), 'the lock file is gone after release');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withDocumentLock reports busy after the timeout instead of waiting forever', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lock2-'));
  const lock = join(dir, 'doc.lock');
  try {
    await writeFile(lock, 'held-by-someone\n', 'utf8');
    await assert.rejects(
      withDocumentLock(lock, async () => 'never', { timeoutMs: 60, retryMs: 5, staleMs: 60_000 }),
      (error: unknown) => error instanceof LockTimeoutError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withDocumentLock reclaims a lock abandoned by a dead process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lock3-'));
  const lock = join(dir, 'doc.lock');
  try {
    await writeFile(lock, 'dead-pid\n', 'utf8');
    const past = new Date(Date.now() - 60_000);
    await utimes(lock, past, past);
    const value = await withDocumentLock(lock, async () => 'reclaimed', {
      timeoutMs: 500,
      retryMs: 5,
      staleMs: 5_000,
    });
    assert.equal(value, 'reclaimed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withDocumentLock releases the lock when the operation throws', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lock4-'));
  const lock = join(dir, 'doc.lock');
  try {
    await assert.rejects(
      withDocumentLock(lock, async () => {
        throw new Error('inner failure');
      }),
      /inner failure/,
    );
    await assert.rejects(readFile(lock, 'utf8'), 'released even when the operation fails');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
