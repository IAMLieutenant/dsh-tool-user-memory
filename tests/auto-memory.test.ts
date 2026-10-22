import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit';
import type { CallId } from '@deepseek-ai/dsh-llm';
import { automaticFact, createAutomaticMemory } from '../src/auto-memory.ts';
import { createMemoryStore } from '../src/store.ts';
import { createMemoryPolicy } from '../src/policy.ts';
import { startManagerServer } from '../src/manager-web.ts';
import * as Plugin from '../src/index.ts';

test('automatic: fixed personal categories accept firsthand facts and reject project rules, transient requests, quotes and invented text', () => {
  for (const [kind, value, quote] of [
    ['background', '我主要做Java后端开发', '我主要做Java后端开发'], ['skill', '我不太熟悉前端', '我不太熟悉前端'],
    ['language', '中文', '我习惯用中文'], ['style', '先说结论', '我喜欢先说结论'], ['style', '通俗易懂', '我喜欢用大白话解释'],
  ]) assert.ok(automaticFact(kind!, value!, quote!, quote!), quote);
  for (const text of ['这个项目我主要做Java后端开发', '记住，发布必须经过我确认', '我今天做Java后端开发', '我喜欢简短，但这次必须先写测试', '> 我主要做Java后端开发', '文档示例：我主要做Java后端开发', '朋友说我主要做Java后端开发']) {
    assert.equal(automaticFact('background', text, text, text), null, text);
  }
  assert.equal(automaticFact('background', '我主要做Java后端开发', '我主要做Java后端开发', '你好'), null);
  assert.equal(automaticFact('project', 'Java17', '我喜欢Java17', '我喜欢Java17'), null);
  assert.equal(automaticFact('background', '我做饭', '我做饭', '我做饭'), null);
  assert.equal(automaticFact('skill', '我不太熟悉前端', '我不太熟悉前端', '我不太熟悉前端')?.key, automaticFact('skill', '我熟悉前端', '我熟悉前端', '我熟悉前端')?.key);
  assert.equal(automaticFact('style', '每次修改代码先确认', '我喜欢每次修改代码先确认', '我喜欢每次修改代码先确认'), null);
});
async function fixture(run: (f: { file: string; store: ReturnType<typeof createMemoryStore>; policy: ReturnType<typeof createMemoryPolicy>; automatic: ReturnType<typeof createAutomaticMemory>; source: { text: string; seq: number; sessionId: string; turn: number } }) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-auto-')), file = join(dir, 'user.md');
  const store = createMemoryStore({ path: file, maxBytes: 8192 }), policy = createMemoryPolicy(file, { mode: 'shared', inject: true }, true);
  try { await run({ file, store, policy, automatic: createAutomaticMemory(store, policy), source: { text: '我主要做Java后端开发', seq: 1, sessionId: 'host-session', turn: 1 } }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
test('automatic: persists verified source, deduplicates, lists by host turn and undo removes only that addition', async () => fixture(async f => {
  const r = await f.automatic.save('background', f.source.text, f.source.text, f.source);
  const entry = (await f.store.list())[0]!; assert.equal(entry.provenance?.method, 'automatic'); assert.equal(entry.provenance?.excerptVerified, true);
  assert.equal((await f.automatic.notices('other', 1)).length, 0); assert.equal((await f.automatic.notices('host-session', 2)).length, 0);
  assert.equal((await f.automatic.notices('host-session', 1)).length, 1);
  assert.equal((await f.automatic.save('background', f.source.text, f.source.text, f.source)).duplicate, true);
  await f.automatic.undo(String(r.key), String(r.id)); assert.equal((await f.store.list()).length, 0);
  await assert.rejects(f.automatic.undo(String(r.key), String(r.id)), /已变化/);
}));
test('automatic: replacement undo restores prior value and pin; later manual edits cannot be undone', async () => fixture(async f => {
  await f.store.update('职业背景', 'Java开发', 'set', '', undefined, true);
  const r = await f.automatic.save('background', f.source.text, f.source.text, f.source);
  await f.automatic.undo(String(r.key), String(r.id)); assert.equal((await f.store.list())[0]!.value, 'Java开发'); assert.equal((await f.store.list())[0]!.pinned, true);
  const again = await f.automatic.save('background', f.source.text, f.source.text, f.source);
  await f.store.update('职业背景', '用户手动修改', 'set');
  await assert.rejects(f.automatic.undo(String(again.key), String(again.id)), /已变化/);
  assert.equal((await f.store.list())[0]!.value, '用户手动修改');
  await f.policy.save({ mode: 'paused', inject: false, diagnostics: false }, f.policy.snapshot().revision);
  await assert.rejects(f.automatic.save('background', f.source.text, f.source.text, f.source), /停用/);
}));
test('automatic: actual registry requires latest human source and prevents replay after undo', async () => fixture(async f => {
  const ctx = new Context(), session = { id: 'real-host', header: { cwd: tmpdir() } };
  try {
    await mountAgentLoopTestDependencies(ctx); await ctx.plugin(Plugin, { path: f.file });
    const call = async (n: number) => (await ctx.tools.execute({ callId: ('auto-'+n) as CallId, name: 'memory_remember', arguments: { kind: 'background', value: f.source.text, excerpt: f.source.text }, signal: new AbortController().signal, agent: { session } as never })).value as Record<string, unknown>;
    assert.equal((await call(1)).ok, false);
    ctx.emit('session/event', session as never, { type: 'user/message', seq: 1, data: { source: { kind: 'plugin' }, content: f.source.text } } as never);
    ctx.emit('session/event', session as never, { type: 'turn/start', seq: 2, data: { turn: 3 } } as never);
    assert.equal((await call(2)).ok, false);
    ctx.emit('session/event', session as never, { type: 'user/message', seq: 3, data: { source: { kind: 'user' }, content: f.source.text } } as never);
    const r = await call(3); assert.equal(r.saved, true); await f.automatic.undo(String(r.key), String(r.id));
    assert.equal((await call(4)).saved, false); assert.equal((await f.store.list()).length, 0);
    ctx.emit('session/event', session as never, { type: 'user/message', seq: 4, data: { source: { kind: 'user' }, content: '你好' } } as never);
    assert.equal((await call(5)).ok, false);
  } finally { await (ctx as unknown as { fiber: { dispose(): Promise<void> } }).fiber.dispose(); }
}));
test('automatic: local notification endpoint requires same-origin token for undo', async () => fixture(async f => {
  await f.automatic.save('background', f.source.text, f.source.text, f.source);
  const { server, url } = await startManagerServer({ profilePath: f.file });
  try {
    const endpoint = url + '/automatic', q = '?session=host-session&turn=1';
    assert.equal((await fetch(endpoint + q, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    const r = await (await fetch(endpoint + q)).json() as { token: string; items: { key: string; id: string }[] };
    const body = JSON.stringify(r.items[0]); assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-memory-token': r.token }, body })).status, 200);
    assert.equal((await f.store.list()).length, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}));
