import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit';
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import type { CallId } from '@deepseek-ai/dsh-llm';
import * as Plugin from '../src/index.ts';
import { createMemoryPolicy, DEFAULT_POLICY } from '../src/policy.ts';
import { createMemoryStore } from '../src/store.ts';
import { createWorkspaceMemory } from '../src/workspace.ts';
import { createMemoryManager } from '../src/manager.ts';
import { createMemoryActivity } from '../src/activity.ts';
import { documentHash } from '../src/history.ts';

test('policy: settings persist, reject stale writes, fail closed, and preserve notes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-policy-')), file = join(dir, 'user.md');
  try {
    await writeFile(file, 'unchanged personal data');
    const policy = createMemoryPolicy(file), original = policy.snapshot();
    assert.deepEqual(original.values, DEFAULT_POLICY);
    await policy.save({ mode: 'shared', inject: true, diagnostics: false }, original.revision);
    assert.equal(createMemoryPolicy(file).read().mode, 'shared');
    await assert.rejects(policy.save(DEFAULT_POLICY, original.revision), /已变化/);
    await assert.rejects(policy.save({ ...DEFAULT_POLICY, mode: 'all' }, policy.snapshot().revision), /格式无效/);
    await writeFile(policy.file, '{broken');
    assert.equal(policy.read().mode, 'paused'); assert.match(policy.snapshot().warning, /损坏/);
    assert.equal(await readFile(file, 'utf8'), 'unchanged personal data');
    await writeFile(policy.file, JSON.stringify({ version: 1, mode: ['project'], inject: true, diagnostics: true }));
    assert.equal(policy.read().mode, 'paused', 'malformed field types must also fail closed');
    await policy.save(DEFAULT_POLICY, policy.snapshot().revision);
    assert.deepEqual(policy.read(), DEFAULT_POLICY);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-user-memory-')), file = join(dir, 'user.md'), base = join(dir, 'notes');
  const a = join(dir, 'project-a'), b = join(dir, 'project-b'); await mkdir(a); await mkdir(b);
  const store = createMemoryStore({ path: file }); await store.update('回答偏好', 'USER_ONLY 中文，先说结论。', 'set');
  const wa = await createWorkspaceMemory({ cwd: a, baseDir: base }), wb = await createWorkspaceMemory({ cwd: b, baseDir: base });
  await wa.write('database', 'PROJECT_A PostgreSQL', 'set'); await wb.write('database', 'PROJECT_B MySQL', 'set');
  const ctx = new Context(); await mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(Plugin, { path: file, workspaceBase: base, projectPath: b, memoryMode: 'project', recordRequests: true, autoConsolidate: true });
  const policy = createMemoryPolicy(file, { mode: 'shared', inject: true }, true);
  const activity = createMemoryActivity(file, () => false), manager = createMemoryManager({ profilePath: file, workspaceBase: base, activity });
  let call = 0;
  const execute = async (name: string, args: Record<string, unknown> = {}, cwd = a) => (await ctx.tools.execute({
    callId: 'user-memory-' + (++call) as CallId, name, arguments: args, signal: new AbortController().signal,
    ...(cwd ? { agent: { session: { id: 'test-session', header: { cwd } } } as never } : {}),
  })).value as Record<string, any>;
  const prompt = async (cwd = a) => renderPrompt(await ctx.systemPrompt.assemble({ agent: { session: { id: cwd, header: { cwd } } } } as never));
  const toggle = async (enabled: boolean) => manager.action({ action: 'set-enabled', revision: policy.snapshot().revision, enabled });
  return { ctx, dir, file, base, a, b, wa, wb, store, policy, manager, activity, execute, prompt, toggle };
}
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  try { await run(f); }
  finally { await (f.ctx as unknown as { fiber: { dispose(): Promise<void> } }).fiber.dispose(); await rm(f.dir, { recursive: true, force: true }); }
}

test('user memory: bounded tools, automatically includes personal preferences across new conversations, no project index', async () => fixture(async f => {
  for (const name of ['memory_get', 'memory_search', 'memory_propose', 'memory_status', 'memory_remember']) assert.ok(f.ctx.tools.get(name), name);
  for (const name of ['memory_topic', 'memory_update', 'memory_export', 'memory_import', 'memory_consolidate']) assert.equal(f.ctx.tools.get(name), undefined, name);
  for (const cwd of [f.a, f.b, '']) {
    assert.match(await f.prompt(cwd), /USER_ONLY/);
    assert.doesNotMatch(await f.prompt(cwd), /PROJECT_A|PROJECT_B|workspace memory index/);
    const result = await f.execute('memory_get', {}, cwd); assert.equal(result.ok, true); assert.match(result.rendered, /USER_ONLY/);
    assert.doesNotMatch(JSON.stringify(await f.execute('memory_search', {}, cwd)), /PROJECT_A|PROJECT_B/);
  }
  assert.equal(existsSync(f.file + '.receipts.json'), false, 'old recordRequests config does not enable ordinary runtime logging');
}));

test('user memory: toggle immediately disables future reads and injection; editing stays available; state persists', async () => fixture(async f => {
  await f.toggle(false); assert.equal((await f.manager.snapshot()).enabled, false);
  assert.equal(JSON.parse(await readFile(f.policy.file, 'utf8')).enabled, false);
  assert.equal(createMemoryPolicy(f.file, { mode: 'shared', inject: true }, true).read().mode, 'paused');
  for (const name of ['memory_get', 'memory_search', 'memory_propose']) {
    const result = await f.execute(name, name === 'memory_propose' ? { key: '偏好', value: '简短' } : {});
    assert.equal(result.ok, false); assert.match(result.error, /停用/);
  }
  assert.doesNotMatch(await f.prompt(), /USER_ONLY/);
  const s = await f.manager.snapshot(); await f.manager.action({ action: 'update', scope: 'global', key: '回答偏好', value: 'UPDATED 中文，短一点。', mode: 'set', revision: s.revision });
  await f.toggle(true); assert.match(await f.prompt(), /UPDATED/); assert.doesNotMatch(await f.prompt(), /USER_ONLY/);
  assert.equal((await f.execute('memory_status')).enabled, true);
  await writeFile(f.policy.file, '{"version":2,"enabled":"yes"}');
  assert.equal((await f.execute('memory_get')).ok, false); assert.doesNotMatch(await f.prompt(), /UPDATED/);
}));

test('user memory: deletion affects future prompts in every directory and leaves old project files untouched', async () => fixture(async f => {
  const a = (await f.wa.read('database'))!.body, b = (await f.wb.read('database'))!.body;
  const s = await f.manager.snapshot(); await f.manager.action({ action: 'update', scope: 'global', key: '回答偏好', value: '', mode: 'remove', revision: s.revision });
  assert.doesNotMatch(await f.prompt(f.a), /USER_ONLY|PROJECT_A/); assert.doesNotMatch(await f.prompt(f.b), /USER_ONLY|PROJECT_B/);
  assert.doesNotMatch(JSON.stringify(await f.execute('memory_get')), /USER_ONLY/);
  assert.equal((await f.wa.read('database'))!.body, a); assert.equal((await f.wb.read('database'))!.body, b);
  const bundle = await f.manager.action({ action: 'export' }) as { projects: unknown[] }; assert.equal(bundle.projects.length, 2);
}));

test('user memory: proposals stay inactive until confirmed; old project candidates are neither shown nor promoted', async () => fixture(async f => {
  const { createCandidateStore } = await import('../src/candidates.ts');
  const old = await createCandidateStore(f.file).propose({ key: 'old project', value: 'PROJECT_FACT', scope: 'workspace', workspacePath: f.a, excerpt: '', reason: '' });
  assert.equal((await f.execute('memory_propose', { key: '解释方式', value: 'PERSONAL_PREF 用大白话解释。' })).ok, true);
  const s = await f.manager.snapshot(); assert.equal(s.candidates.length, 1); assert.equal(s.candidates[0]!.scope, 'global');
  assert.doesNotMatch(await f.prompt(), /PERSONAL_PREF|PROJECT_FACT/);
  const c = s.candidates[0]!, values = { id: c.id, revision: c.revision, scope: 'global', key: c.key, value: c.value };
  const p = await f.manager.action({ action: 'preview-candidate', ...values }) as { previewToken: string };
  await f.manager.action({ action: 'accept-candidate', ...values, previewToken: p.previewToken });
  assert.match(await f.prompt(), /PERSONAL_PREF/);
  await assert.rejects(f.manager.action({ action: 'preview-candidate', id: old.id, revision: documentHash(JSON.stringify(old)), scope: 'global', key: old.key, value: old.value }), /只保存用户记忆/);
  await assert.rejects(f.manager.action({ action: 'update', scope: 'workspace', projectId: '1234567890abcdef', key: 'database', mode: 'set', value: 'x', revision: '' }), /只保存用户记忆/);
  const s2 = await f.manager.snapshot('1234567890abcdef'); assert.ok(s2.entries.every(e => !e.value.includes('PROJECT_')));
}));

test('user memory: invalidated entries stay excluded from reads, search and prompt', async () => fixture(async f => {
  await f.store.update('回答偏好', '', 'invalidate', 'old');
  assert.doesNotMatch(await f.prompt(), /USER_ONLY/);
  assert.doesNotMatch(JSON.stringify(await f.execute('memory_get', { includeStale: true })), /USER_ONLY/);
  assert.doesNotMatch(JSON.stringify(await f.execute('memory_search', { includeStale: true })), /USER_ONLY/);
}));

test('user memory: message saving records verified personal source without creating project memory', async () => fixture(async f => {
  const session = { id: 'source-session', header: { cwd: f.a } };
  f.activity.observe(session, { type: 'user/message', seq: 0, data: { source: { kind: 'user' }, content: '以后解释问题请用大白话。' } });
  f.activity.observe(session, { type: 'turn/start', seq: 1, data: { turn: 1 } });
  const r = await f.manager.action({ action: 'propose-message', sessionId: session.id, seq: 0, excerpt: '解释问题请用大白话', key: '解释偏好', value: '用大白话解释。' }) as { candidate: { scope: string; workspacePath?: string; excerptVerified: boolean; sourceRole: string } };
  assert.equal(r.candidate.scope, 'global'); assert.equal(r.candidate.workspacePath, undefined); assert.equal(r.candidate.excerptVerified, true); assert.equal(r.candidate.sourceRole, 'user');
  await assert.rejects(f.manager.action({ action: 'propose-message', sessionId: session.id, seq: 0, excerpt: '解释问题请用大白话', key: 'x', value: 'x', scope: 'workspace' }), /只保存用户记忆/);
  assert.equal(existsSync(f.file + '.receipts.json'), false);
}));

test('user memory: earlier disabled or project-only settings do not silently enable global preferences', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-user-policy-')), file = join(dir, 'user.md');
  try {
    const p = createMemoryPolicy(file, { mode: 'shared', inject: true }, true);
    await writeFile(p.file, JSON.stringify({ version: 1, mode: 'project', inject: true, diagnostics: true }));
    assert.equal(p.read().mode, 'paused');
    await p.save({ mode: 'shared', inject: true, diagnostics: false }, p.snapshot().revision);
    assert.deepEqual(JSON.parse(await readFile(p.file, 'utf8')), { version: 2, enabled: true });
    const revision = p.snapshot().revision; await p.save({ mode: 'paused', inject: false, diagnostics: false }, revision);
    await assert.rejects(p.save({ mode: 'shared', inject: true, diagnostics: false }, revision), /已变化/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
