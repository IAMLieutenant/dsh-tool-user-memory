import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVED_KEYS,
  evictToBudget,
  isStale,
  mergeEntry,
  orderByRecency,
  parseProfile,
  renderEntries,
  renderEntriesBudgeted,
  serializeProfile,
  validateKey,
} from '../src/profile.ts';

const T1 = '2026-08-14T00:00:00.000Z';
const T2 = '2026-08-15T00:00:00.000Z';
const T3 = '2026-08-16T00:00:00.000Z';

test('parse/serialize round-trips values with ##, backslash, and metadata-looking lines', () => {
  const value = ['zh-CN', '## fake heading', '\\# literal', '<!-- ts: not metadata -->', '## another'].join(
    '\n',
  );
  const entries = [{ key: 'language', value, updatedAt: T1, invalidatedAt: '', invalidReason: '' }];
  assert.deepEqual(parseProfile(serializeProfile(entries)), entries);
});

test('parse/serialize round-trip preserves per-entry timestamps', () => {
  const entries = [
    { key: 'language', value: 'zh-CN', updatedAt: T1, invalidatedAt: '', invalidReason: '' },
    { key: 'style', value: '简洁', updatedAt: T2, invalidatedAt: '', invalidReason: '' },
  ];
  assert.deepEqual(parseProfile(serializeProfile(entries)), entries);
});

test('parseProfile ignores title/comment lines and blank lines', () => {
  const entries = parseProfile('# User Memory\n\n<!-- note -->\n\n## lang\nzh\n');
  assert.deepEqual(entries, [
    { key: 'lang', value: 'zh', updatedAt: '', invalidatedAt: '', invalidReason: '' },
  ]);
});

test('mergeEntry: set replaces, append adds a line, remove deletes (with timestamps)', () => {
  let entries = parseProfile('');
  entries = mergeEntry(entries, 'language', 'zh-CN', 'set', T1);
  entries = mergeEntry(entries, 'style', '简洁', 'set', T2);
  entries = mergeEntry(entries, 'style', '直接', 'append', T3);
  assert.deepEqual(entries, [
    { key: 'language', value: 'zh-CN', updatedAt: T1, invalidatedAt: '', invalidReason: '' },
    { key: 'style', value: '简洁\n直接', updatedAt: T3, invalidatedAt: '', invalidReason: '' },
  ]);
  entries = mergeEntry(entries, 'style', '', 'remove', T3);
  assert.deepEqual(entries, [
    { key: 'language', value: 'zh-CN', updatedAt: T1, invalidatedAt: '', invalidReason: '' },
  ]);
});

test('mergeEntry: append creates the key when missing', () => {
  const out = mergeEntry([], 'goals', 'contribute to harness', 'append', T1);
  assert.deepEqual(out, [
    { key: 'goals', value: 'contribute to harness', updatedAt: T1, invalidatedAt: '', invalidReason: '' },
  ]);
});

test('mergeEntry trims key whitespace and rejects invalid keys', () => {
  const out = mergeEntry([], '  lang  ', 'zh', 'set', T1);
  assert.equal(out[0]!.key, 'lang');
  assert.throws(() => mergeEntry([], '   ', 'x', 'set', T1));
  assert.throws(() => mergeEntry([], 'a\nb', 'x', 'set', T1));
});

test('validateKey rejects empty, newline, and over-long keys; allows unicode', () => {
  assert.equal(validateKey(''), 'key must be a non-empty string');
  assert.ok(validateKey('a\nb')?.includes('single line'));
  assert.ok(validateKey('x'.repeat(129))?.includes('128'));
  assert.equal(validateKey('language'), null);
  assert.equal(validateKey('中文键'), null);
});

test('orderByRecency sorts newest first, empty timestamps last', () => {
  const entries = [
    { key: 'a', value: 'a', updatedAt: '' },
    { key: 'b', value: 'b', updatedAt: T1 },
    { key: 'c', value: 'c', updatedAt: T3 },
    { key: 'd', value: 'd', updatedAt: T2 },
  ];
  assert.deepEqual(
    orderByRecency(entries).map((e) => e.key),
    ['c', 'd', 'b', 'a'],
  );
});

test('evictToBudget drops oldest entries first and reports evicted keys', () => {
  const entries = [
    { key: 'oldest', value: 'x'.repeat(50), updatedAt: T1, invalidatedAt: '', invalidReason: '' },
    { key: 'middle', value: 'y'.repeat(50), updatedAt: T2, invalidatedAt: '', invalidReason: '' },
    { key: 'newest', value: 'z'.repeat(50), updatedAt: T3, invalidatedAt: '', invalidReason: '' },
  ];
  const budget = Buffer.byteLength(serializeProfile(entries.slice(1)), 'utf8');
  const { kept, evicted, truncated } = evictToBudget(entries, budget);
  assert.deepEqual(evicted, ['oldest']);
  assert.deepEqual(
    kept.map((e) => e.key),
    ['middle', 'newest'],
  );
  assert.equal(truncated, null);
});

test('evictToBudget truncates a single oversized entry instead of dropping it', () => {
  const entries = [{ key: 'huge', value: 'x'.repeat(5000), updatedAt: T1, invalidatedAt: '', invalidReason: '' }];
  const budget = 200;
  const { kept, evicted, truncated } = evictToBudget(entries, budget);
  assert.deepEqual(evicted, []);
  assert.equal(truncated, 'huge');
  assert.equal(kept.length, 1);
  assert.ok(kept[0]!.value.includes('[truncated]'));
  assert.ok(Buffer.byteLength(serializeProfile(kept), 'utf8') <= budget);
});

test('renderEntries excludes reserved keys', () => {
  const entries = [
    { key: 'language', value: 'zh-CN', updatedAt: T1, invalidatedAt: '', invalidReason: '' },
    { key: 'updated-at', value: '2026-01-01T00:00:00.000Z', updatedAt: '', invalidatedAt: '', invalidReason: '' },
  ];
  const rendered = renderEntries(entries);
  assert.ok(rendered.includes('language'));
  assert.ok(!rendered.includes('updated-at'));
});

test('renderEntriesBudgeted keeps the newest entry and omits the rest without splitting', () => {
  const entries = [
    { key: 'old', value: 'a'.repeat(1000), updatedAt: T1, invalidatedAt: '', invalidReason: '' },
    { key: 'new', value: 'b'.repeat(1000), updatedAt: T3, invalidatedAt: '', invalidReason: '' },
  ];
  const { text, omitted } = renderEntriesBudgeted(entries, 120);
  assert.ok(text.includes('## new'));
  assert.ok(!text.includes('## old'));
  assert.equal(omitted, 1);
});

test('RESERVED_KEYS contains updated-at', () => {
  assert.ok(RESERVED_KEYS.has('updated-at'));
});

const INV = '2026-09-01T00:00:00.000Z';

test('mergeEntry: invalidate soft-deletes with reason; set revives', () => {
  let entries = mergeEntry([], 'project', 'rag-service', 'set', T1);
  entries = mergeEntry(entries, 'project', '', 'invalidate', INV, 'moved to agent platform');
  assert.deepEqual(entries[0], {
    key: 'project',
    value: 'rag-service',
    updatedAt: T1,
    invalidatedAt: INV,
    invalidReason: 'moved to agent platform',
  });
  entries = mergeEntry(entries, 'project', 'agent-platform', 'set', T3);
  assert.deepEqual(entries[0], {
    key: 'project',
    value: 'agent-platform',
    updatedAt: T3,
    invalidatedAt: '',
    invalidReason: '',
  });
});

test('mergeEntry: invalidating an unknown key throws', () => {
  assert.throws(() => mergeEntry([], 'ghost', '', 'invalidate', T1));
});

test('mergeEntry: invalidation reason is single-line and length-capped', () => {
  const base = [{ key: 'a', value: 'v', updatedAt: T1, invalidatedAt: '', invalidReason: '' }];
  const twoLines = mergeEntry(base, 'a', '', 'invalidate', T2, 'line1\nline2');
  assert.equal(twoLines[0]!.invalidReason, 'line1');
  const long = mergeEntry(twoLines, 'a', '', 'invalidate', T2, 'x'.repeat(500));
  assert.equal(long[0]!.invalidReason.length, 200);
});

test('parse/serialize round-trip preserves invalidation metadata', () => {
  const entries = [
    {
      key: 'gone',
      value: 'old-project',
      updatedAt: T1,
      invalidatedAt: INV,
      invalidReason: 'superseded by: new | pipe',
    },
    { key: 'no-reason', value: 'v', updatedAt: T2, invalidatedAt: INV, invalidReason: '' },
    { key: 'alive', value: 'w', updatedAt: T3, invalidatedAt: '', invalidReason: '' },
  ];
  assert.deepEqual(parseProfile(serializeProfile(entries)), entries);
});

test('isStale respects threshold, disabled at 0, unknown timestamps never stale', () => {
  const fresh = { key: 'a', value: 'v', updatedAt: '2026-10-01T00:00:00.000Z', invalidatedAt: '', invalidReason: '' };
  const now = '2026-10-20T00:00:00.000Z';
  assert.equal(isStale(fresh, now, 30), false);
  assert.equal(isStale(fresh, '2026-11-20T00:00:00.000Z', 30), true);
  assert.equal(isStale(fresh, now, 0), false);
  assert.equal(isStale({ ...fresh, updatedAt: '' }, now, 30), false);
});

test('renderEntries annotates stale and invalidated entries only when configured', () => {
  const now = '2026-11-20T00:00:00.000Z';
  const stale = {
    key: 'old-habit',
    value: 'v',
    updatedAt: '2026-10-01T00:00:00.000Z',
    invalidatedAt: '',
    invalidReason: '',
  };
  const dead = {
    key: 'ex-project',
    value: 'x',
    updatedAt: T1,
    invalidatedAt: '2026-09-01T00:00:00.000Z',
    invalidReason: 'moved on',
  };
  const plain = renderEntries([stale, dead]);
  assert.ok(!plain.includes('[stale'), 'stale marker requires the option');
  assert.ok(plain.includes('## ex-project [invalidated 2026-09-01: moved on]'), 'invalidated marker is unconditional');
  assert.ok(!plain.includes('## old-habit ['), 'valid fresh entry gets no marker');
  const annotated = renderEntries([stale, dead], { now, staleAfterDays: 30 });
  assert.ok(annotated.includes('## old-habit [stale: last updated 50d ago]'));
  assert.ok(annotated.includes('## ex-project [invalidated 2026-09-01: moved on]'));
});

test('evictToBudget evicts invalidated entries before live ones', () => {
  const liveOld = { key: 'live-old', value: 'y'.repeat(50), updatedAt: T1, invalidatedAt: '', invalidReason: '' };
  const deadNew = { key: 'dead-new', value: 'x'.repeat(50), updatedAt: T3, invalidatedAt: T3, invalidReason: '' };
  const liveNew = { key: 'live-new', value: 'z'.repeat(50), updatedAt: T2, invalidatedAt: '', invalidReason: '' };
  const entries = [liveOld, deadNew, liveNew];
  const budget = Buffer.byteLength(serializeProfile([liveOld, liveNew]), 'utf8');
  const { evicted } = evictToBudget(entries, budget);
  assert.deepEqual(evicted, ['dead-new']);
});
