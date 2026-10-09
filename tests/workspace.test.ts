/**
 * Workspace memory layer tests: pure topic-file parsing/serialization, index
 * building, keyword scoring, and the real-file store (set/append/invalidate/
 * remove + index regeneration + identity stability).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TOPIC_MAX_BYTES,
  buildIndexText,
  createWorkspaceMemory,
  normalizeTopic,
  parseTopicFile,
  readWorkspaceIndexSync,
  readWorkspaceSync,
  searchTopics,
  serializeTopicFile,
  type WorkspaceTopic,
} from '../src/workspace.ts';

const T1 = '2026-08-14T00:00:00.000Z';
const T2 = '2026-08-15T00:00:00.000Z';
const T3 = '2026-08-16T00:00:00.000Z';

function topic(over: Partial<WorkspaceTopic> & { topic: string }): WorkspaceTopic {
  return {
    body: '',
    updatedAt: T1,
    invalidatedAt: '',
    invalidReason: '',
    ...over,
  };
}

test('parseTopicFile/serializeTopicFile round-trips bodies, escaped lines, and invalidation', () => {
  const alive = topic({
    topic: 'build-conventions',
    body: 'pnpm only\n## not a heading\n\\# literal\n<!-- ts: fake -->',
    updatedAt: T1,
  });
  assert.deepEqual(parseTopicFile(serializeTopicFile(alive)), alive);

  const dead = topic({
    topic: 'old-deploy',
    body: 'ship via ftp',
    updatedAt: T1,
    invalidatedAt: T2,
    invalidReason: 'migrated: ci | cd',
  });
  assert.deepEqual(parseTopicFile(serializeTopicFile(dead)), dead);
});

test('normalizeTopic rejects unsafe names and normalizes inner whitespace', () => {
  assert.deepEqual(normalizeTopic('  Build   Conventions  '), { ok: true, topic: 'Build Conventions' });
  assert.deepEqual(normalizeTopic('中文 主题'), { ok: true, topic: '中文 主题' });
  assert.equal(normalizeTopic('   ').ok, false);
  assert.equal(normalizeTopic('a/b').ok, false);
  assert.equal(normalizeTopic('a\\b').ok, false);
  assert.equal(normalizeTopic('a:b').ok, false);
  assert.equal(normalizeTopic('.hidden').ok, false);
  assert.equal(normalizeTopic('x'.repeat(65)).ok, false);
});

test('buildIndexText lists valid topics newest first with a summary line', () => {
  const topics = [
    topic({ topic: 'older', body: 'first line\nsecond line', updatedAt: T1 }),
    topic({ topic: 'newer', body: 'summary here', updatedAt: T3 }),
    topic({ topic: 'gone', body: 'nope', updatedAt: T3, invalidatedAt: T3, invalidReason: 'x' }),
  ];
  const text = buildIndexText(topics, 'D:\\proj');
  assert.ok(text.startsWith('# Workspace Memory\n<!-- ws: D:\\proj -->\n'));
  assert.ok(text.includes('## newer\n<!-- ts: 2026-08-16T00:00:00.000Z -->\nsummary here'));
  assert.ok(text.includes('## older'));
  assert.ok(text.includes('first line'));
  assert.ok(!text.includes('nope'), 'invalidated topics leave the index');
  assert.ok(text.indexOf('## newer') < text.indexOf('## older'), 'newest topic first');
});

test('searchTopics ranks name/body hits, excludes invalidated by default, matches CJK substrings', () => {
  const topics = [
    topic({ topic: 'build', body: 'use pnpm, never npm\nrun pnpm test', updatedAt: T1 }),
    topic({ topic: 'deploy', body: 'ship via ci', updatedAt: T2 }),
    topic({ topic: '测试主题', body: '这个主题关于记忆测试', updatedAt: T2 }),
    topic({ topic: 'dead', body: 'pnpm pnpm pnpm', updatedAt: T2, invalidatedAt: T2, invalidReason: 'gone' }),
  ];

  const byBody = searchTopics(topics, 'pnpm');
  assert.deepEqual(byBody.map((h) => h.topic), ['build']);
  assert.equal(byBody[0]!.score, 2, 'two body occurrences');

  const coverage = searchTopics(topics, 'build test');
  assert.equal(coverage[0]!.topic, 'build');
  assert.equal(coverage[0]!.score, 8, 'name hit (3) + body occurrence (1) + full-coverage bonus (4)');

  const cjk = searchTopics(topics, '记忆');
  assert.deepEqual(cjk.map((h) => h.topic), ['测试主题']);

  const withStale = searchTopics(topics, 'pnpm', true);
  assert.deepEqual(withStale.map((h) => h.topic), ['dead', 'build'], 'invalidated ranked by score when asked');
  assert.ok(withStale[0]!.snippet.startsWith('[invalidated 2026-08-15: gone]'));

  const all = searchTopics(topics, '');
  assert.deepEqual(all.map((h) => h.topic), ['deploy', '测试主题', 'build'], 'empty query = recent valid topics');
  assert.ok(all.every((h) => h.score === 0));
});

test('createWorkspaceMemory: set/append/invalidate/remove round-trip + index regeneration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-ws-'));
  try {
    const base = join(dir, 'mem-base');
    const ws = await createWorkspaceMemory({ cwd: dir, baseDir: base });
    assert.ok(ws.dir.startsWith(base), 'base override is honoured');
    assert.equal(await ws.read('build'), undefined);

    assert.equal((await ws.write('build', 'use pnpm', 'set')).ok, true);
    assert.equal((await ws.write('build', 'and pnpm lint', 'append')).ok, true);
    assert.equal((await ws.read('build'))?.body, 'use pnpm\nand pnpm lint');
    assert.ok(existsSync(join(ws.dir, 'build.md')));
    assert.ok(existsSync(join(ws.dir, 'MEMORY.md')), 'index written on every mutation');
    assert.ok((await ws.indexText()).includes('## build'));

    const invalidated = await ws.write('build', '', 'invalidate', 'migrated to bun');
    assert.equal(invalidated.ok, true);
    const dead = await ws.read('build');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(dead!.invalidatedAt));
    assert.equal(dead!.invalidReason, 'migrated to bun');
    assert.equal(dead!.body, 'use pnpm\nand pnpm lint', 'body survives invalidation');
    assert.ok(!(await ws.indexText()).includes('## build'), 'invalidated topic leaves the index');
    assert.equal((await ws.search('pnpm')).length, 0, 'invalidated topic leaves search by default');

    assert.equal((await ws.write('ghost', '', 'invalidate', 'x')).ok, false, 'unknown topic cannot be invalidated');

    assert.equal((await ws.write('build', 'bun now', 'set')).ok, true);
    assert.equal((await ws.read('build'))!.invalidatedAt, '', 'set revives');
    assert.ok((await ws.indexText()).includes('## build'));

    assert.equal((await ws.write('build', '', 'remove')).ok, true);
    assert.equal(await ws.read('build'), undefined);
    assert.ok(!existsSync(join(ws.dir, 'build.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createWorkspaceMemory: rejects bad topic names and oversized bodies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-ws2-'));
  try {
    const ws = await createWorkspaceMemory({ cwd: dir, baseDir: join(dir, 'base') });
    const bad = await ws.write('a/b', 'v', 'set');
    assert.equal(bad.ok, false);
    assert.ok(bad.error?.includes('filename-reserved'));
    const huge = await ws.write('big', 'x'.repeat(TOPIC_MAX_BYTES + 1), 'set');
    assert.equal(huge.ok, false);
    assert.ok(huge.error?.includes('exceeds'));
    assert.equal(await ws.read('big'), undefined, 'nothing written on rejection');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createWorkspaceMemory: the same cwd resolves to the same directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-ws3-'));
  try {
    const base = join(dir, 'base');
    const a = await createWorkspaceMemory({ cwd: dir, baseDir: base });
    const b = await createWorkspaceMemory({ cwd: `${dir}${process.platform === 'win32' ? '\\' : '/'}.`, baseDir: base });
    assert.equal(a.dir, b.dir);
    assert.equal(a.path, b.path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readWorkspaceIndexSync returns the index for a cwd, null when empty or missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-ws4-'));
  try {
    const base = join(dir, 'base');
    assert.equal(readWorkspaceIndexSync(dir, base), null, 'no memory yet');
    const ws = await createWorkspaceMemory({ cwd: dir, baseDir: base });
    await ws.write('conventions', 'run pnpm test before commit', 'set');
    const index = readWorkspaceIndexSync(dir, base);
    assert.ok(index !== null);
    assert.ok(index.text.includes('## conventions'));
    assert.ok(index.text.includes('run pnpm test before commit'));
    assert.equal(index.path, ws.path);
    assert.equal(readWorkspaceIndexSync(join(dir, 'nope'), base), null, 'missing cwd');
    await ws.write('conventions', '', 'invalidate', 'stale');
    assert.equal(readWorkspaceIndexSync(dir, base), null, 'only invalidated topics = no index');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readWorkspaceSync skips unreadable topic entries instead of throwing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-ws5-'));
  try {
    const base = join(dir, 'base');
    const ws = await createWorkspaceMemory({ cwd: dir, baseDir: base });
    await ws.write('good', 'fine', 'set');
    // A directory named like a topic file: readdir lists it, readFile fails.
    await mkdir(join(ws.dir, 'broken.md'), { recursive: true });
    const topics = readWorkspaceSync(ws.dir);
    assert.deepEqual(
      topics.map((t) => t.topic),
      ['good'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
