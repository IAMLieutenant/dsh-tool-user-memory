import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../src/store.ts';
import { createWorkspaceMemory, parseTopicFile, serializeTopicFile } from '../src/workspace.ts';
import { parseProfile, serializeProfile, type ProfileEntry } from '../src/profile.ts';
import { applyMemoryImport, exportMemoryBundle, exportMemoryFile, parseMemoryBundle,
  previewMemoryImport, rollbackMemoryImport, setMigrationWriteHook,
  type ImportOptions, type MemoryBundle } from '../src/migration.ts';

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-02-01T00:00:00.000Z';
function entry(key = 'language', value = '中文'): ProfileEntry {
  return { key, value, updatedAt: T1, invalidatedAt: '', invalidReason: '' };
}
function bundle(): MemoryBundle {
  return { format: 'dsh-user-memory', version: 1, exportedAt: T2,
    profile: [entry(), { ...entry('old-role', '旧角色'), invalidatedAt: T2, invalidReason: '角色变更' }],
    projects: [{ id: '1234567890abcdef', sourcePath: 'D:\\old\\demo', topics: [
      { topic: 'Build', body: 'pnpm build', updatedAt: T1, invalidatedAt: '', invalidReason: '' },
      { topic: 'retired', body: 'ftp deploy', updatedAt: T1, invalidatedAt: T2, invalidReason: '已更换部署方式' },
    ] }],
  };
}
async function fixture() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-migration-'));
  const project = join(dir, 'new-project');
  await fs.mkdir(project);
  const source = join(dir, 'transfer.json');
  await fs.writeFile(source, JSON.stringify(bundle()));
  const options: ImportOptions = { profilePath: join(dir, 'memory', 'user.md'), workspaceBase: join(dir, 'memory', 'workspace'),
    projectMap: [{ id: '1234567890abcdef', path: project }] };
  const store = createMemoryStore({ path: options.profilePath, maxBytes: 8192 });
  const ws = await createWorkspaceMemory({ cwd: project, baseDir: options.workspaceBase });
  return { dir, source, options, project, store, ws, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('migration: transfer to a new project preserves metadata and rebuilds the index', async () => {
  const f = await fixture();
  try {
    const preview = await previewMemoryImport(f.source, f.options);
    assert.equal(preview.profile?.added, 2);
    assert.equal(preview.projects[0]?.summary.added, 2);
    await assert.rejects(fs.stat(join(f.dir, 'memory')), { code: 'ENOENT' });
    const result = await applyMemoryImport(f.source, preview.previewToken, f.options);
    assert.ok(result.backupPath);
    assert.deepEqual(await f.store.list(), bundle().profile);
    assert.deepEqual(await f.ws.read('Build'), bundle().projects[0]!.topics[0]);
    assert.deepEqual(await f.ws.read('retired'), bundle().projects[0]!.topics[1]);
    const index = await fs.readFile(join(f.ws.dir, 'MEMORY.md'), 'utf8');
    assert.ok(index.includes(f.ws.path));
    assert.ok(!index.includes('D:\\old\\demo'));
    assert.ok(!index.includes('retired'));
    assert.ok(!(await f.ws.search('ftp')).length);
  } finally { await f.cleanup(); }
});

test('migration: default keeps local conflicts and repeated import is a no-op', async () => {
  const f = await fixture();
  try {
    await f.store.update('language', 'English', 'set');
    await f.ws.write('build', 'npm run build', 'set');
    const originalTopic = await f.ws.read('build');
    const preview = await previewMemoryImport(f.source, f.options);
    assert.equal(preview.profile?.kept, 1);
    assert.equal(preview.projects[0]?.summary.kept, 1);
    await applyMemoryImport(f.source, preview.previewToken, f.options);
    assert.equal((await f.store.list()).find(e => e.key === 'language')?.value, 'English');
    assert.deepEqual(await f.ws.read('Build'), originalTopic);
    const again = await previewMemoryImport(f.source, f.options);
    assert.equal(again.filesToWrite, 0);
    assert.equal((await applyMemoryImport(f.source, again.previewToken, f.options)).backupPath, null);
  } finally { await f.cleanup(); }
});

test('migration: replacement keeps destination topic spelling and backup can restore raw files', async () => {
  const f = await fixture();
  try {
    await f.store.update('language', 'English', 'set');
    await f.ws.write('build', 'npm run build', 'set');
    const rawProfile = await f.store.read();
    const rawTopic = await fs.readFile(join(f.ws.dir, 'build.md'), 'utf8');
    const rawIndex = await fs.readFile(join(f.ws.dir, 'MEMORY.md'), 'utf8');
    const options = { ...f.options, policy: 'use-imported' as const };
    const preview = await previewMemoryImport(f.source, options);
    assert.equal(preview.profile?.replaced, 1);
    const result = await applyMemoryImport(f.source, preview.previewToken, options);
    assert.equal((await f.ws.read('build'))?.body, 'pnpm build');
    assert.equal((await f.ws.read('build'))?.updatedAt, T1);
    assert.deepEqual((await fs.readdir(f.ws.dir)).filter(n => n.toLowerCase() === 'build.md'), ['build.md']);
    await rollbackMemoryImport(result.backupPath!, f.options);
    assert.equal(await f.store.read(), rawProfile);
    assert.equal(await fs.readFile(join(f.ws.dir, 'build.md'), 'utf8'), rawTopic);
    assert.equal(await fs.readFile(join(f.ws.dir, 'MEMORY.md'), 'utf8'), rawIndex);
    assert.equal(await f.ws.read('retired'), undefined);
    await rollbackMemoryImport(result.backupPath!, f.options); // idempotent
  } finally { await f.cleanup(); }
});

test('migration: preview token rejects destination edits, new topics, changed bundle and changed policy', async () => {
  const f = await fixture();
  try {
    let preview = await previewMemoryImport(f.source, f.options);
    await f.store.update('new', 'new session wrote this', 'set');
    await assert.rejects(applyMemoryImport(f.source, preview.previewToken, f.options), /preview changed/);
    preview = await previewMemoryImport(f.source, f.options);
    await f.ws.write('new-topic', 'parallel session', 'set');
    await assert.rejects(applyMemoryImport(f.source, preview.previewToken, f.options), /preview changed/);
    preview = await previewMemoryImport(f.source, f.options);
    await assert.rejects(applyMemoryImport(f.source, preview.previewToken, { ...f.options, policy: 'use-imported' }), /preview changed/);
    await fs.writeFile(f.source, JSON.stringify({ ...bundle(), exportedAt: T1 }));
    await assert.rejects(applyMemoryImport(f.source, preview.previewToken, f.options), /preview changed/);
    assert.equal((await f.store.list()).length, 1);
  } finally { await f.cleanup(); }
});

test('migration: mutation after preliminary check is caught inside document locks', async () => {
  const f = await fixture();
  try {
    await f.store.update('local', 'before', 'set');
    const preview = await previewMemoryImport(f.source, f.options);
    const { withDocumentLock } = await import('../src/lock.ts');
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(r => { entered = r; });
    const gate = new Promise<void>(r => { release = r; });
    const holder = withDocumentLock(`${f.options.profilePath}.lock`, async () => {
      entered(); await gate;
      await fs.writeFile(f.options.profilePath!, serializeProfile([entry('local', 'after')]));
    });
    await ready;
    const applying = applyMemoryImport(f.source, preview.previewToken, f.options);
    await new Promise(r => setTimeout(r, 30));
    release(); await holder;
    await assert.rejects(applying, /memory changed since preview|preview changed/);
    assert.equal((await f.store.list())[0]?.value, 'after');
  } finally { await f.cleanup(); }
});

test('migration: unmapped projects are skipped; profile can be skipped independently', async () => {
  const f = await fixture();
  try {
    const global = { ...f.options, projectMap: [] };
    const preview = await previewMemoryImport(f.source, global);
    assert.equal(preview.unmapped.length, 1);
    await applyMemoryImport(f.source, preview.previewToken, global);
    assert.deepEqual(await f.ws.list(), []);
    const projectOnly = { ...f.options, includeProfile: false };
    const before = await f.store.read();
    const next = await previewMemoryImport(f.source, projectOnly);
    assert.equal(next.profile, null);
    await applyMemoryImport(f.source, next.previewToken, projectOnly);
    assert.equal(await f.store.read(), before);
    assert.equal((await f.ws.list()).length, 2);
  } finally { await f.cleanup(); }
});

test('migration: export finds archived projects without requiring the old cwd', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(join(f.dir, 'memory'), { recursive: true });
    await fs.writeFile(f.options.profilePath!, serializeProfile(bundle().profile));
    await f.ws.write('Build', 'pnpm build', 'set');
    await fs.writeFile(join(f.ws.dir, 'retired.md'), serializeTopicFile(bundle().projects[0]!.topics[1]!));
    await fs.rm(f.project, { recursive: true });
    const exported = await exportMemoryBundle(f.options);
    assert.deepEqual(exported.profile, bundle().profile);
    assert.equal(exported.projects.length, 1);
    assert.equal(exported.projects[0]?.topics.length, 2);
    assert.equal(exported.projects[0]?.sourcePath, f.ws.path);
    assert.equal(exported.projects[0]?.topics.find(t => t.topic === 'retired')?.invalidatedAt, T2);
    assert.equal((await exportMemoryBundle(f.options, 'global')).projects.length, 0);
    const output = join(f.dir, 'export.json');
    await exportMemoryFile(output, f.options);
    await assert.rejects(exportMemoryFile(output, f.options), { code: 'EEXIST' });
    await assert.rejects(exportMemoryFile(f.options.profilePath!, f.options), /outside/);
    assert.equal(parseMemoryBundle(await fs.readFile(output, 'utf8')).projects.length, 1);
  } finally { await f.cleanup(); }
});

test('migration: capacity overflow aborts before writes or backups and never evicts', async () => {
  const f = await fixture();
  try {
    await f.store.update('local', 'must remain', 'set');
    const before = await f.store.read();
    await assert.rejects(previewMemoryImport(f.source, { ...f.options, maxBytes: 64 }), /exceeds 64 bytes/);
    assert.equal(await f.store.read(), before);
    await assert.rejects(fs.stat(join(f.dir, 'memory', 'migration-backups')), { code: 'ENOENT' });
    await assert.rejects(applyMemoryImport(f.source, '', f.options), /preview first/);
  } finally { await f.cleanup(); }
});

test('migration: rejects malicious names, duplicate topics, reserved keys, invalid timestamps and versions', () => {
  for (const name of ['../outside', 'MEMORY', 'NUL', '.hidden', 'bad\nname']) {
    const data = bundle(); data.projects[0]!.topics[0]!.topic = name;
    assert.throws(() => parseMemoryBundle(JSON.stringify(data)), /invalid topic/);
  }
  const duplicate = bundle(); duplicate.projects[0]!.topics.push({ ...duplicate.projects[0]!.topics[0]!, topic: 'build' });
  assert.throws(() => parseMemoryBundle(JSON.stringify(duplicate)), /duplicate topic/);
  const reserved = bundle(); reserved.profile[0]!.key = 'updated-at';
  assert.throws(() => parseMemoryBundle(JSON.stringify(reserved)), /invalid profile key/);
  const badTime = bundle(); badTime.profile[0]!.updatedAt = '<!-- injected -->';
  assert.throws(() => parseMemoryBundle(JSON.stringify(badTime)), /ISO timestamp/);
  assert.throws(() => parseMemoryBundle(JSON.stringify({ ...bundle(), version: 2 })), /unsupported/);
  const badReason = bundle(); badReason.profile[0]!.invalidReason = 'line1\nline2';
  assert.throws(() => parseMemoryBundle(JSON.stringify(badReason)), /single line/);
});

test('migration: rejects ambiguous, unknown and inaccessible project mappings', async () => {
  const f = await fixture();
  try {
    await assert.rejects(previewMemoryImport(f.source, { ...f.options, projectMap: [{ id: 'unknown', path: f.project }] }), /unknown/);
    await assert.rejects(previewMemoryImport(f.source, { ...f.options, projectMap: [...f.options.projectMap!, ...f.options.projectMap!] }), /duplicate/);
    await assert.rejects(previewMemoryImport(f.source, { ...f.options, projectMap: [{ id: '1234567890abcdef', path: join(f.dir, 'absent') }] }), { code: 'ENOENT' });
    const data = bundle(); data.projects.push({ ...data.projects[0]!, id: 'abcdef1234567890' });
    await fs.writeFile(f.source, JSON.stringify(data));
    await assert.rejects(previewMemoryImport(f.source, { ...f.options, projectMap: [
      ...f.options.projectMap!, { id: 'abcdef1234567890', path: f.project },
    ] }), /same directory/);
  } finally { await f.cleanup(); }
});

test('migration: mid-write failure automatically restores every original document', async () => {
  const f = await fixture();
  let restore = () => {};
  try {
    await f.store.update('local', 'original', 'set');
    await f.ws.write('original', 'keep me', 'set');
    const before = await f.store.read();
    const beforeIndex = await fs.readFile(join(f.ws.dir, 'MEMORY.md'), 'utf8');
    const preview = await previewMemoryImport(f.source, f.options);
    let failed = false;
    restore = setMigrationWriteHook(file => {
      if (file === join(f.ws.dir, 'MEMORY.md') && !failed) { failed = true; throw new Error('simulated disk failure'); }
    });
    await assert.rejects(applyMemoryImport(f.source, preview.previewToken, f.options), /rolled-back/);
    assert.equal(await f.store.read(), before);
    assert.equal(await fs.readFile(join(f.ws.dir, 'MEMORY.md'), 'utf8'), beforeIndex);
    assert.equal(await f.ws.read('Build'), undefined);
    assert.equal(await f.ws.read('retired'), undefined);
    const backups = await fs.readdir(join(f.dir, 'memory', 'migration-backups'));
    const journal = JSON.parse(await fs.readFile(join(f.dir, 'memory', 'migration-backups', backups[0]!), 'utf8'));
    assert.equal(journal.status, 'rolled-back');
  } finally { restore(); await f.cleanup(); }
});

test('migration: failure to save the backup leaves memory untouched', async () => {
  const f = await fixture();
  let restore = () => {};
  try {
    await f.store.update('local', 'original', 'set');
    const before = await f.store.read();
    const preview = await previewMemoryImport(f.source, f.options);
    restore = setMigrationWriteHook(file => { if (file.includes('migration-backups')) throw new Error('backup unavailable'); });
    await assert.rejects(applyMemoryImport(f.source, preview.previewToken, f.options), /backup unavailable/);
    assert.equal(await f.store.read(), before);
    assert.equal(await f.ws.read('Build'), undefined);
  } finally { restore(); await f.cleanup(); }
});

test('migration: rollback refuses to overwrite edits made after import or arbitrary file paths', async () => {
  const f = await fixture();
  try {
    const preview = await previewMemoryImport(f.source, f.options);
    const result = await applyMemoryImport(f.source, preview.previewToken, f.options);
    await f.store.update('new', 'after import', 'set');
    const before = await f.store.read();
    await assert.rejects(rollbackMemoryImport(result.backupPath!, f.options), /subsequently changed/);
    assert.equal(await f.store.read(), before);
    const journal = JSON.parse(await fs.readFile(result.backupPath!, 'utf8'));
    journal.files[0].path = join(f.dir, 'arbitrary.txt');
    await fs.writeFile(result.backupPath!, JSON.stringify(journal));
    await assert.rejects(rollbackMemoryImport(result.backupPath!, f.options), /outside/);
  } finally { await f.cleanup(); }
});

test('migration: refuses broken stored topics instead of silently excluding them from export', async () => {
  const f = await fixture();
  try {
    await f.ws.write('build', 'pnpm build', 'set');
    await fs.writeFile(join(f.ws.dir, 'bad.md'), 'not a topic file');
    await assert.rejects(exportMemoryBundle(f.options), /invalid topic/);
    await assert.rejects(previewMemoryImport(f.source, f.options), /invalid topic/);
    assert.deepEqual(parseProfile(serializeProfile(bundle().profile)), bundle().profile);
    assert.deepEqual(parseTopicFile(serializeTopicFile(bundle().projects[0]!.topics[1]!)), bundle().projects[0]!.topics[1]);
  } finally { await f.cleanup(); }
});
