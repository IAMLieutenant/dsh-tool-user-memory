import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { utimes, writeFile } from 'node:fs/promises';
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
    assert.deepEqual(
      entries.map((e) => e.key),
      ['language', 'style'],
    );
    assert.deepEqual(
      entries.map((e) => e.value),
      ['zh-CN', '简洁\n直接'],
    );
    assert.ok(entries.every((e) => /^\d{4}-\d{2}-\d{2}T/.test(e.updatedAt)));

    result = await store.update('style', '', 'remove');
    assert.equal(result.ok, true);
    assert.deepEqual(
      (await store.list()).map((e) => e.key),
      ['language'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: reserved, empty, and multiline keys are rejected', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 8192 });
    const reserved = await store.update('updated-at', 'x', 'set');
    assert.equal(reserved.ok, false);
    assert.ok(reserved.error?.includes('reserved'));
    const empty = await store.update('   ', 'x', 'set');
    assert.equal(empty.ok, false);
    const multiline = await store.update('a\nb', 'x', 'set');
    assert.equal(multiline.ok, false);
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

test('store: a value containing ## lines survives a write/read round-trip', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 8192 });
    const value = '第一行\n## 假的标题\n第三行';
    await store.update('bio', value, 'set');
    const entries = await store.list();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.key, 'bio');
    assert.equal(entries[0]!.value, value);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: oversized profiles evict oldest entries and report them', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 400 });
    await store.update('first', 'x'.repeat(120), 'set');
    await store.update('second', 'y'.repeat(120), 'set');
    const result = await store.update('third', 'z'.repeat(120), 'set');
    assert.equal(result.ok, true);
    assert.ok(result.evicted.includes('first'));
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes('## third'));
    assert.ok(!text.includes('## first'));
    assert.ok(Buffer.byteLength(text, 'utf8') <= 400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: a single oversized value is truncated, never dropped', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 200 });
    const result = await store.update('big', 'x'.repeat(500), 'set');
    assert.equal(result.ok, true);
    assert.equal(result.truncated, 'big');
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes('[truncated]'));
    assert.ok(text.includes('## big'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: invalidate keeps the value, records reason; set revives', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 8192 });
    await store.update('project', 'rag-service', 'set');
    const result = await store.update('project', '', 'invalidate', 'moved to agent platform');
    assert.equal(result.ok, true);
    let entries = await store.list();
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(entries[0]!.invalidatedAt));
    assert.equal(entries[0]!.invalidReason, 'moved to agent platform');
    assert.equal(entries[0]!.value, 'rag-service');
    let text = readFileSync(file, 'utf8');
    assert.ok(text.includes('<!-- invalid:'));
    assert.ok(text.includes('moved to agent platform'));
    const revived = await store.update('project', 'agent-platform', 'set');
    assert.equal(revived.ok, true);
    entries = await store.list();
    assert.equal(entries[0]!.invalidatedAt, '');
    assert.equal(entries[0]!.invalidReason, '');
    assert.equal(entries[0]!.value, 'agent-platform');
    text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('<!-- invalid:'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: invalidating an unknown key fails cleanly', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 8192 });
    const result = await store.update('ghost', '', 'invalidate', 'why');
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes('does not exist'));
    assert.equal(await store.read(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: every concurrent update survives', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 65536 });
    await store.update('seed', 'x', 'set');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.update(`k${i}`, `v${i}`, 'set')),
    );
    assert.ok(
      results.every((result) => result.ok),
      'every concurrent writer is told it succeeded',
    );
    const keys = (await store.list()).map((entry) => entry.key);
    assert.equal(keys.length, 21, 'the seed plus twenty concurrent entries');
    for (let i = 0; i < 20; i += 1) assert.ok(keys.includes(`k${i}`), `k${i} survived`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: rewrite edits a value without refreshing its timestamp', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 8192 });
    await store.update('plan', 'tomorrow I ship the release', 'set');
    const before = (await store.list())[0]!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await store.rewrite('plan', `${before.value}\n(recorded 2026-01-01; relative dates refer to this date)`);
    assert.equal(result.ok, true);
    const after = (await store.list())[0]!;
    assert.equal(after.updatedAt, before.updatedAt, 'an edit is not a fresh confirmation');
    assert.ok(after.value.includes('(recorded '));
    const missing = await store.rewrite('ghost', 'x');
    assert.equal(missing.ok, false);
    assert.ok(missing.error?.includes('does not exist'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: an abandoned lock file is reclaimed instead of blocking forever', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'user.md');
    const store = createMemoryStore({ path: file, maxBytes: 8192 });
    await writeFile(`${file}.lock`, '99999 2026-01-01T00:00:00.000Z\n', 'utf8');
    const past = new Date(Date.now() - 60_000);
    await utimes(`${file}.lock`, past, past);
    const result = await store.update('after-crash', 'v', 'set');
    assert.equal(result.ok, true, 'the stale lock is reclaimed');
    assert.deepEqual(
      (await store.list()).map((entry) => entry.key),
      ['after-crash'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
