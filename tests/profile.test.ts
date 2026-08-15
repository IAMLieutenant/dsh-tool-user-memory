import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVED_KEYS,
  evictToBudget,
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
  const entries = [{ key: 'language', value, updatedAt: T1 }];
  assert.deepEqual(parseProfile(serializeProfile(entries)), entries);
});

test('parse/serialize round-trip preserves per-entry timestamps', () => {
  const entries = [
    { key: 'language', value: 'zh-CN', updatedAt: T1 },
    { key: 'style', value: '简洁', updatedAt: T2 },
  ];
  assert.deepEqual(parseProfile(serializeProfile(entries)), entries);
});

test('parseProfile ignores title/comment lines and blank lines', () => {
  const entries = parseProfile('# User Memory\n\n<!-- note -->\n\n## lang\nzh\n');
  assert.deepEqual(entries, [{ key: 'lang', value: 'zh', updatedAt: '' }]);
});

test('mergeEntry: set replaces, append adds a line, remove deletes (with timestamps)', () => {
  let entries = parseProfile('');
  entries = mergeEntry(entries, 'language', 'zh-CN', 'set', T1);
  entries = mergeEntry(entries, 'style', '简洁', 'set', T2);
  entries = mergeEntry(entries, 'style', '直接', 'append', T3);
  assert.deepEqual(entries, [
    { key: 'language', value: 'zh-CN', updatedAt: T1 },
    { key: 'style', value: '简洁\n直接', updatedAt: T3 },
  ]);
  entries = mergeEntry(entries, 'style', '', 'remove', T3);
  assert.deepEqual(entries, [{ key: 'language', value: 'zh-CN', updatedAt: T1 }]);
});

test('mergeEntry: append creates the key when missing', () => {
  const out = mergeEntry([], 'goals', 'contribute to harness', 'append', T1);
  assert.deepEqual(out, [{ key: 'goals', value: 'contribute to harness', updatedAt: T1 }]);
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
    { key: 'oldest', value: 'x'.repeat(50), updatedAt: T1 },
    { key: 'middle', value: 'y'.repeat(50), updatedAt: T2 },
    { key: 'newest', value: 'z'.repeat(50), updatedAt: T3 },
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
  const entries = [{ key: 'huge', value: 'x'.repeat(5000), updatedAt: T1 }];
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
    { key: 'language', value: 'zh-CN', updatedAt: T1 },
    { key: 'updated-at', value: '2026-01-01T00:00:00.000Z', updatedAt: '' },
  ];
  const rendered = renderEntries(entries);
  assert.ok(rendered.includes('language'));
  assert.ok(!rendered.includes('updated-at'));
});

test('renderEntriesBudgeted keeps the newest entry and omits the rest without splitting', () => {
  const entries = [
    { key: 'old', value: 'a'.repeat(1000), updatedAt: T1 },
    { key: 'new', value: 'b'.repeat(1000), updatedAt: T3 },
  ];
  const { text, omitted } = renderEntriesBudgeted(entries, 120);
  assert.ok(text.includes('## new'));
  assert.ok(!text.includes('## old'));
  assert.equal(omitted, 1);
});

test('RESERVED_KEYS contains updated-at', () => {
  assert.ok(RESERVED_KEYS.has('updated-at'));
});
