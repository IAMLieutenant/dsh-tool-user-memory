import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../src/store.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-user-memory-test-'));
}

test('store: set/append/remove round-trip with a real file', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 8192 });

    let result = await store.update('language', 'zh-CN', 'set');
    assert.equal(result.ok, true);
    result = await store.update('style', '简洁', 'set');
    assert.equal(result.ok, true);
    result = await store.update('style', '直接', 'append');
    assert.equal(result.ok, true);

    const doc = await store.read();
    assert.ok(doc.includes('## language'));
    assert.ok(doc.includes('zh-CN'));
    assert.ok(doc.includes('简洁\n直接'));

    const entries = await store.list();
    assert.deepEqual(entries, [
      { key: 'language', value: 'zh-CN' },
      { key: 'style', value: '简洁\n直接' },
    ]);

    result = await store.update('style', '', 'remove');
    assert.equal(result.ok, true);
    assert.deepEqual(await store.list(), [{ key: 'language', value: 'zh-CN' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: reserved and empty keys are rejected', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 8192 });
    const reserved = await store.update('updated-at', 'x', 'set');
    assert.equal(reserved.ok, false);
    assert.ok(reserved.error?.includes('reserved'));
    const empty = await store.update('   ', 'x', 'set');
    assert.equal(empty.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: missing file reads as empty, write creates nested dirs', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'nested', 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 8192 });
    assert.equal(await store.read(), '');
    await store.update('a', 'b', 'set');
    assert.ok(existsSync(file));
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes('## a'));
    assert.ok(text.includes('## updated-at'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: oversized profiles are truncated with a marker', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 200 });
    await store.update('big', 'x'.repeat(500), 'set');
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes('truncated'));
    assert.ok(Buffer.byteLength(text, 'utf8') < 500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
