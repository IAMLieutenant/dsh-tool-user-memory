import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryActivity } from '../src/activity.ts';
import { createMemoryStore } from '../src/store.ts';
import { memoryPromptSnapshot, memoryPromptPreview } from '../src/prompt.ts';
import { createMemoryManager } from '../src/manager.ts';
import { createWorkspaceMemory } from '../src/workspace.ts';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-activity-')), profilePath = join(dir, 'user.md'), workspaceBase = join(dir, 'ws');
  const activity = createMemoryActivity(profilePath), store = createMemoryStore({ path: profilePath, maxBytes: 8192 });
  const session = { id: 'session-one', header: { cwd: dir } };
  let seq = 0;
  const emit = (type: string, data: unknown) => activity.observe(session, { type, data, seq: seq++ });
  const manager = createMemoryManager({ profilePath, workspaceBase, activity, userOnly: false });
  return { dir, profilePath, workspaceBase, activity, store, session, emit, manager, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
test('activity: previews are side effect free; actual request freezes budget, invalidation and workspace-index decisions', async () => {
  const f = await fixture();
  try {
    await f.store.update('old', 'old fact', 'set');
    await f.store.update('new', 'new fact', 'set');
    await f.store.update('dead', 'expired', 'set'); await f.store.update('dead', '', 'invalidate', 'superseded');
    const ws = await createWorkspaceMemory({ cwd: f.dir, baseDir: f.workspaceBase }); await ws.write('database', 'PostgreSQL', 'set');
    const snapshot = memoryPromptSnapshot(f.store, f.dir, 28, 0, 512, f.workspaceBase);
    assert.equal(snapshot.text, memoryPromptPreview(f.store, f.dir, 28, 0, 512, f.workspaceBase));
    assert.equal((await f.activity.receipts()).records.length, 0);
    f.emit('turn/start', { turn: 1 }); f.emit('step/start', { turn: 1, step: 1 });
    f.activity.stage(f.session.id, snapshot);
    f.activity.capture({ sessionId: f.session.id, messages: [{ role: 'system', content: snapshot.text }] });
    await f.store.update('new', 'changed after request', 'set');
    const r = (await f.activity.receipts()).records[0]!;
    assert.equal(r.promptText, snapshot.text);
    assert.ok(r.items.some(i => i.status === 'budget'));
    assert.equal(r.items.find(i => i.key === 'dead')!.status, 'invalidated');
    assert.equal(r.items.find(i => i.key === 'database')!.status, 'index');
    assert.ok(!r.promptText.includes('changed after request'));
    assert.equal((await createMemoryActivity(f.profilePath).receipts()).records.length, 1);
  } finally { await f.cleanup(); }
});
test('activity: complete prompt overrides are not reported as memory delivery; reads bind to their step', async () => {
  const f = await fixture();
  try {
    await f.store.update('language', '中文', 'set');
    f.emit('turn/start', { turn: 2 }); f.emit('step/start', { turn: 2, step: 3 });
    f.activity.stage(f.session.id, memoryPromptSnapshot(f.store, f.dir));
    f.activity.capture({ sessionId: f.session.id, messages: [{ role: 'system', content: 'complete custom prompt' }] });
    f.activity.read(f.session.id, 'workspace', 'database', 'PostgreSQL');
    const r = (await f.activity.receipts(f.session.id, 2)).records[0]!;
    assert.equal(r.promptText, ''); assert.equal(r.items[0]!.status, 'overridden');
    assert.deepEqual(r.reads, [{ scope: 'workspace', key: 'database', text: 'PostgreSQL' }]);
    assert.equal((await f.activity.receipts('another-session')).records.length, 0);
    assert.equal((await f.activity.receipts(f.session.id, 9)).records.length, 0);
    f.emit('turn/end', { turn: 2 });
    f.activity.read(f.session.id, 'global', 'late read', 'not part of that request');
    assert.equal((await f.activity.receipts()).records[0]!.reads.length, 1);
    await f.activity.clear(); assert.equal((await f.activity.receipts()).records.length, 0);
    assert.equal((await f.store.list()).length, 1);
  } finally { await f.cleanup(); }
});
test('activity: source selection verifies host message, excludes reasoning and preserves assistant attribution', async () => {
  const f = await fixture();
  try {
    f.emit('user/message', { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'injected text' }] });
    f.emit('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '默认中文，先给结论。' }] });
    f.emit('turn/start', { turn: 1 });
    f.emit('assistant/message', { turn: 1, message: { content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: '数据库已迁到 PostgreSQL。' }] } });
    const result = await f.manager.action({ action: 'source-messages', sessionId: f.session.id, turn: 1 }) as { messages: { seq: number; role: string; text: string }[] };
    assert.equal(result.messages.length, 2); assert.ok(!JSON.stringify(result).includes('private reasoning'));
    const source = result.messages.find(m => m.role === 'assistant')!;
    const request = { action: 'propose-message', sessionId: f.session.id, seq: source.seq, excerpt: 'PostgreSQL', key: '数据库', value: '项目使用 PostgreSQL', scope: 'workspace', sourceRole: 'user', workspacePath: 'C:/forged' };
    const proposed = await f.manager.action(request) as { candidate: { id: string; revision: string; projectId: string; workspacePath: string; sourceRole: string } };
    assert.equal(proposed.candidate.sourceRole, 'assistant'); assert.equal(proposed.candidate.workspacePath, f.dir);
    assert.equal((await f.store.list()).length, 0);
    const values = { id: proposed.candidate.id, revision: proposed.candidate.revision, key: '数据库', value: '项目使用 PostgreSQL', scope: 'workspace', projectId: proposed.candidate.projectId };
    const preview = await f.manager.action({ action: 'preview-candidate', ...values }) as { previewToken: string };
    await f.manager.action({ action: 'accept-candidate', ...values, previewToken: preview.previewToken });
    const ws = await createWorkspaceMemory({ cwd: f.dir, baseDir: f.workspaceBase });
    assert.equal((await ws.read('数据库'))!.provenance!.sourceRole, 'assistant');
    await assert.rejects(f.manager.action({ ...request, excerpt: 'invented quote' }), /原话/);
    await assert.rejects(f.manager.action({ ...request, sessionId: 'forged' }), /原话/);
  } finally { await f.cleanup(); }
});
test('activity: bounded retention, disabled injection, literal truncation marker and source cwd stay accurate', async () => {
  const f = await fixture();
  try {
    await f.store.update('literal', '文字中提及 [truncated]', 'set');
    assert.equal(memoryPromptSnapshot(f.store, f.dir).items[0]!.status, 'provided');
    const snapshot = memoryPromptSnapshot(f.store, f.dir, 2048, 0, 0, '', 'directory', '', false);
    assert.equal(snapshot.text, ''); assert.equal(snapshot.items[0]!.status, 'disabled');
    f.emit('user/message', { source: { kind: 'user' }, content: 'source text' }); f.emit('turn/start', { turn: 1 });
    f.emit('working-directory/change', { cwd: 'C:/another-project' });
    assert.equal(f.activity.source(f.session.id, 0, 'source').cwd, f.dir);
    f.activity.stage(f.session.id, snapshot);
    for (let i = 0; i < 53; i++) f.activity.capture({ sessionId: f.session.id, messages: [] });
    assert.equal((await f.activity.receipts()).records.length, 50);
  } finally { await f.cleanup(); }
});
