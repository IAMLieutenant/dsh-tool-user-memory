import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createCandidateStore } from '../src/candidates.ts';
import { createMemoryManager } from '../src/manager.ts';
import { createMemoryStore } from '../src/store.ts';
import { createWorkspaceMemory, workspaceHashOf } from '../src/workspace.ts';
import { memoryPromptPreview } from '../src/prompt.ts';
import { exportMemoryBundle, parseMemoryBundle, applyMemoryBundle, previewMemoryBundle } from '../src/migration.ts';
import { listHistory } from '../src/history.ts';

async function fixture(maxBytes = 8192) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-candidate-'));
  const options = { profilePath: join(dir, 'user.md'), workspaceBase: join(dir, 'workspaces'), maxBytes };
  const store = createMemoryStore({ path: options.profilePath, maxBytes });
  return { dir, options, store, manager: createMemoryManager(options), candidates: createCandidateStore(options.profilePath),
    cleanup: () => rm(dir, { recursive: true, force: true }) };
}
async function proposal(f: Awaited<ReturnType<typeof fixture>>, scope: 'global' | 'workspace' = 'global') {
  return f.candidates.propose({ key: 'database', value: '项目已迁移到 PostgreSQL', scope, ...(scope === 'workspace' ? { workspacePath: f.dir } : {}), sourceSessionId: 'host-session', excerpt: '现在已经迁到 PostgreSQL 了', reason: '用户纠正了数据库类型' });
}
async function values(f: Awaited<ReturnType<typeof fixture>>, id: string, scope: 'global' | 'workspace' = 'global') {
  const c = (await f.manager.snapshot()).candidates.find(c => c.id === id)!;
  return { id, revision: c.revision, key: c.key, value: c.value, scope, projectId: c.projectId, pinned: false };
}
async function accept(f: Awaited<ReturnType<typeof fixture>>, v: Awaited<ReturnType<typeof values>>) {
  const p = await f.manager.action({ action: 'preview-candidate', ...v }) as { previewToken: string };
  return f.manager.action({ action: 'accept-candidate', ...v, previewToken: p.previewToken });
}

test('candidates: concurrent duplicate proposals are one pending item, absent from prompt and export', async () => {
  const f = await fixture();
  try {
    const all = await Promise.all(Array.from({ length: 8 }, () => proposal(f)));
    assert.equal(new Set(all.map(c => c.id)).size, 1);
    assert.equal((await f.manager.snapshot()).candidates.length, 1);
    assert.equal(memoryPromptPreview(f.store, f.dir), '');
    assert.equal((await exportMemoryBundle(f.options)).profile.length, 0);
  } finally { await f.cleanup(); }
});

test('candidates: confirm correction replaces active content, retains evidence and old history', async () => {
  const f = await fixture();
  try {
    await f.store.update('database', 'MySQL', 'set');
    const c = await proposal(f), v = await values(f, c.id);
    const p = await f.manager.action({ action: 'preview-candidate', ...v }) as { before: string; previewToken: string };
    assert.equal(p.before, 'MySQL');
    await f.manager.action({ action: 'accept-candidate', ...v, previewToken: p.previewToken });
    const saved = (await f.store.list())[0]!;
    assert.equal(saved.value, c.value); assert.equal(saved.provenance?.sourceSessionId, 'host-session');
    assert.equal(saved.provenance?.previousValue, 'MySQL'); assert.ok(saved.provenance?.confirmedAt);
    assert.ok((await listHistory(f.options.profilePath)).some(h => h.before?.includes('MySQL')));
    assert.equal((await f.manager.snapshot()).candidates.length, 0);
    const prompt = memoryPromptPreview(f.store, f.dir);
    assert.ok(prompt.includes('PostgreSQL')); assert.ok(!prompt.includes('MySQL')); assert.ok(!prompt.includes('memory-origin'));
    await assert.rejects(accept(f, v), /候选/);
  } finally { await f.cleanup(); }
});

test('candidates: changed target, scope, pinned flag or edited text invalidate a preview', async () => {
  const f = await fixture();
  try {
    const c = await proposal(f), v = await values(f, c.id);
    const p = await f.manager.action({ action: 'preview-candidate', ...v }) as { previewToken: string };
    for (const altered of [{ value: 'other' }, { pinned: true }, { scope: 'workspace', projectId: 'fake' }]) {
      await assert.rejects(f.manager.action({ action: 'accept-candidate', ...v, ...altered, previewToken: p.previewToken }));
    }
    await f.store.update('database', 'newer edit', 'set');
    await assert.rejects(f.manager.action({ action: 'accept-candidate', ...v, previewToken: p.previewToken }), /变化/);
    assert.equal((await f.store.list())[0]!.value, 'newer edit');
    assert.equal((await f.manager.snapshot()).candidates.length, 1);
  } finally { await f.cleanup(); }
});

test('candidates: project-only confirmation does not leak into another workspace or global memory', async () => {
  const f = await fixture();
  try {
    const c = await proposal(f, 'workspace'), v = await values(f, c.id, 'workspace');
    await accept(f, v);
    assert.equal((await f.store.list()).length, 0);
    const ws = await createWorkspaceMemory({ cwd: f.dir, baseDir: f.options.workspaceBase });
    const saved = (await ws.read('database'))!;
    assert.equal(saved.body, c.value); assert.equal(saved.provenance?.candidateId, c.id);
    assert.ok(memoryPromptPreview(f.store, f.dir, 2048, 0, 512, f.options.workspaceBase).includes('PostgreSQL'));
    const elsewhere = join(f.dir, 'other'); await mkdir(elsewhere);
    assert.ok(!memoryPromptPreview(f.store, elsewhere, 2048, 0, 512, f.options.workspaceBase).includes('PostgreSQL'));
    assert.equal((await f.manager.snapshot(basename(ws.dir))).entries[0]!.provenance?.candidateId, c.id);
  } finally { await f.cleanup(); }
});

test('candidates: user can change a project proposal to global; arbitrary project targets are refused', async () => {
  const f = await fixture();
  try {
    const c = await proposal(f, 'workspace'), v = await values(f, c.id);
    await assert.rejects(f.manager.action({ action: 'preview-candidate', ...v, scope: 'workspace', projectId: '0000000000000000' }), /来源项目/);
    await accept(f, v);
    assert.equal((await f.store.list())[0]!.value, c.value);
  } finally { await f.cleanup(); }
});

test('candidates: insufficient capacity keeps active memory intact and proposal pending', async () => {
  const f = await fixture(250);
  try {
    await f.store.update('keep', 'do not lose this', 'set'); const before = await f.store.read();
    const c = await proposal(f), v = await values(f, c.id);
    await assert.rejects(accept(f, v), /容量/);
    assert.equal(await f.store.read(), before); assert.equal((await f.manager.snapshot()).candidates.length, 1);
  } finally { await f.cleanup(); }
});

test('candidates: correction preserves an existing pin unless the reviewer explicitly changes it', async () => {
  const f = await fixture();
  try {
    await f.store.update('database', 'MySQL', 'set', '', undefined, true);
    const c = await proposal(f), { pinned: _pin, ...v } = await values(f, c.id);
    const p = await f.manager.action({ action: 'preview-candidate', ...v }) as { pinned: boolean; previewToken: string };
    assert.equal(p.pinned, true);
    await f.manager.action({ action: 'accept-candidate', ...v, previewToken: p.previewToken });
    assert.equal((await f.store.list())[0]!.pinned, true);
  } finally { await f.cleanup(); }
});

test('candidates: dismissal never writes active memory and cannot be replayed', async () => {
  const f = await fixture();
  try {
    const c = await proposal(f), v = await values(f, c.id);
    await f.manager.action({ action: 'dismiss-candidate', id: c.id, revision: v.revision });
    assert.equal(await f.store.read(), ''); assert.equal((await f.manager.snapshot()).candidates.length, 0);
    await assert.rejects(f.manager.action({ action: 'dismiss-candidate', id: c.id, revision: v.revision }), /已处理/);
  } finally { await f.cleanup(); }
});

test('provenance: export/import and project mapping preserve confirmed evidence', async () => {
  const f = await fixture(), dest = await fixture();
  try {
    const g = await proposal(f); await accept(f, await values(f, g.id));
    const w = await proposal(f, 'workspace'); await accept(f, await values(f, w.id, 'workspace'));
    const doc = JSON.stringify(await exportMemoryBundle(f.options)), bundle = parseMemoryBundle(doc);
    assert.equal(bundle.profile[0]!.provenance?.candidateId, g.id);
    assert.equal(bundle.projects[0]!.topics[0]!.provenance?.candidateId, w.id);
    const options = { ...dest.options, projectMap: [{ id: workspaceHashOf(f.dir), path: dest.dir }] };
    const p = await previewMemoryBundle(doc, options); await applyMemoryBundle(doc, p.previewToken, options);
    assert.equal((await dest.store.list())[0]!.provenance?.candidateId, g.id);
    const ws = await createWorkspaceMemory({ cwd: dest.dir, baseDir: dest.options.workspaceBase });
    assert.equal((await ws.read('database'))!.provenance?.candidateId, w.id);
  } finally { await f.cleanup(); await dest.cleanup(); }
});

test('provenance: later tool edits revoke the old confirmation and do not claim old evidence', async () => {
  const f = await fixture();
  try {
    const c = await proposal(f); await accept(f, await values(f, c.id));
    const created = (await f.store.list())[0]!.provenance!.createdAt;
    await f.store.update('database', 'SQLite', 'set');
    const origin = (await f.store.list())[0]!.provenance!;
    assert.equal(origin.createdAt, created); assert.equal(origin.method, 'tool'); assert.equal(origin.confirmedAt, undefined); assert.equal(origin.excerpt, undefined);
  } finally { await f.cleanup(); }
});

test('candidates: recovery after target commit does not overwrite it or allow misleading dismissal', async () => {
  const f = await fixture();
  try {
    const c = await proposal(f), v = await values(f, c.id);
    const pending = await readFile(f.candidates.file, 'utf8');
    await accept(f, v);
    await writeFile(f.candidates.file, pending); // simulate crash before queue status commit
    await assert.rejects(f.manager.action({ action: 'dismiss-candidate', id: c.id, revision: v.revision }), /已写入/);
    const before = await f.store.read();
    await f.manager.action({ action: 'accept-candidate', ...v, previewToken: 'old-preview' });
    assert.equal(await f.store.read(), before); assert.equal((await f.manager.snapshot()).candidates.length, 0);
  } finally { await f.cleanup(); }
});
