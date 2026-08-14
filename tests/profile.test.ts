import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVED_KEYS,
  mergeEntry,
  parseProfile,
  renderEntries,
  serializeProfile,
  truncateBytes,
} from '../src/profile.ts';

test('parse/serialize round-trip', () => {
  const doc =
    '# User Memory\n\n## language\nzh-CN\n\n## communication-style\n简洁、直接\n多行值\n';
  const entries = parseProfile(doc);
  assert.deepEqual(entries, [
    { key: 'language', value: 'zh-CN' },
    { key: 'communication-style', value: '简洁、直接\n多行值' },
  ]);
  const reparsed = parseProfile(serializeProfile(entries));
  assert.deepEqual(reparsed, entries);
});

test('parseProfile ignores comment/title lines and blank lines', () => {
  const entries = parseProfile('# User Memory\n\n<!-- note -->\n\n## lang\nzh\n');
  assert.deepEqual(entries, [{ key: 'lang', value: 'zh' }]);
});

test('mergeEntry: set replaces, append adds a line, remove deletes', () => {
  let entries = parseProfile('');
  entries = mergeEntry(entries, 'language', 'zh-CN', 'set');
  entries = mergeEntry(entries, 'style', '简洁', 'set');
  entries = mergeEntry(entries, 'style', '直接', 'append');
  assert.deepEqual(entries, [
    { key: 'language', value: 'zh-CN' },
    { key: 'style', value: '简洁\n直接' },
  ]);
  entries = mergeEntry(entries, 'style', '', 'remove');
  assert.deepEqual(entries, [{ key: 'language', value: 'zh-CN' }]);
});

test('mergeEntry: append creates the key when missing', () => {
  const out = mergeEntry([], 'goals', 'contribute to harness', 'append');
  assert.deepEqual(out, [{ key: 'goals', value: 'contribute to harness' }]);
});

test('mergeEntry rejects empty keys and trims whitespace', () => {
  assert.throws(() => mergeEntry([], '   ', 'x', 'set'));
  const out = mergeEntry([], '  lang  ', 'zh', 'set');
  assert.equal(out[0].key, 'lang');
});

test('truncateBytes keeps head and tail and marks truncation', () => {
  const doc = 'a'.repeat(100) + '中'.repeat(100) + 'b'.repeat(100);
  const cut = truncateBytes(doc, 120);
  assert.ok(cut.startsWith('a'.repeat(32))); // head half preserved
  assert.ok(cut.includes('... [truncated] ...')); // marker present
  assert.ok(cut.includes('b'.repeat(32))); // tail half preserved
  assert.ok(cut.includes('<!-- truncated:')); // footer present
  assert.ok(Buffer.byteLength(cut, 'utf8') < Buffer.byteLength(doc, 'utf8'));
});

test('truncateBytes returns the document unchanged when within limit', () => {
  const doc = 'short';
  assert.equal(truncateBytes(doc, 8192), doc);
});

test('truncateBytes is byte-aware for multibyte text', () => {
  const doc = '中'.repeat(200);
  const cut = truncateBytes(doc, 100);
  assert.ok(cut.startsWith('中'));
  assert.ok(cut.includes('... [truncated] ...'));
  assert.ok(cut.includes('中'.repeat(7))); // 7 × 3 bytes = 21 ≤ half(22)
  assert.ok(Buffer.byteLength(cut, 'utf8') < Buffer.byteLength(doc, 'utf8'));
});

test('renderEntries excludes reserved keys', () => {
  const entries = [
    { key: 'language', value: 'zh-CN' },
    { key: 'updated-at', value: '2026-01-01T00:00:00.000Z' },
  ];
  const rendered = renderEntries(entries);
  assert.ok(rendered.includes('language'));
  assert.ok(!rendered.includes('updated-at'));
});

test('RESERVED_KEYS contains updated-at', () => {
  assert.ok(RESERVED_KEYS.has('updated-at'));
});
