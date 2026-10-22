/**
 * Loop-level tests: mount the FULL agent loop (dsh-agent-loop) with a scripted
 * stub LLM adapter, let a real agent decide to call `memory_update`, and verify
 * the preference is persisted, the loop completes both turns, and the
 * turn-boundary consolidation trigger runs in the background.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryActivity } from '../src/activity.ts';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit';
import type { Agent } from '@deepseek-ai/dsh-agent';
import * as ToolUserMemory from '../src/index.ts';
import { StubAdapter } from './stub-adapter.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 10000, intervalMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

async function disposeCtx(ctx: Context): Promise<void> {
  const fiber = (ctx as unknown as { fiber?: { dispose?: () => Promise<unknown> | void } }).fiber;
  if (fiber?.dispose) await fiber.dispose();
}

test('loop: agent calls memory_update through the real agent loop and persists', async () => {
  // Use a fresh temp subdirectory (the sandbox allows temp-subdir writes).
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-loop-'));
  const file = join(dir, 'user.md');
  const ctx = new Context();
  let agent: Agent | undefined;
  let streamCalls = 0;
  try {
    await mountAgentLoopTestDependencies(ctx);
    const adapter = new StubAdapter();
    ctx.llm.registerAdapter(['stub'], adapter);
    ctx.on('agent/created', (entry) => {
      if ((entry as { agent?: Agent }).agent?.id?.startsWith('loop-agent-')) {
        agent = (entry as { agent: Agent }).agent;
      }
    });
    await ctx.plugin(ToolUserMemory, { path: file, maxBytes: 8192, includeInPrompt: true, memoryMode: 'shared', legacyTools: true, recordRequests: true });
    await ctx.plugin(AgentLoop, {
      agents: [{ id: 'loop-agent', provider: 'stub', model: 'stub-model' }],
    });

    const created = await waitFor(() => agent != null);
    assert.ok(created, 'config agent created and captured via agent/created');

    const streamBefore = adapter.calls;
    // Drive one turn: the stub model first requests memory_update, then answers.
    agent!.followup({ content: '请记住我的语言偏好：中文' } as never);

    const persisted = await waitFor(
      () => {
        try {
          return existsSync(file) && readFileSync(file, 'utf8').includes('## language');
        } catch {
          return false;
        }
      },
      15000,
    );
    assert.ok(persisted, 'memory_update executed through the loop and persisted');
    assert.ok(readFileSync(file, 'utf8').includes('zh-CN'), 'value persisted');

    // Both model calls must have happened: tool-call turn + final-answer turn.
    const settled = await waitFor(() => adapter.calls >= streamBefore + 2, 10000);
    assert.ok(settled, 'loop completed the tool-call turn and the final-answer turn');
    const activity = createMemoryActivity(file);
    assert.ok(await waitFor(() => existsSync(activity.file), 10000), 'real LLM boundary produced a receipt');
    const receipts = await activity.receipts();
    assert.ok(receipts.records.length >= 2, 'each model request has its own receipt');
    assert.ok(receipts.records.some(r => r.promptText.includes('zh-CN')), 'later request recorded the newly saved memory');
    assert.ok(receipts.records.every(r => r.sessionId === agent!.session.id));
    for await (const _chunk of ctx.llm.stream({ provider: 'stub', model: 'stub-model', sessionId: agent!.session.id,
      signal: new AbortController().signal, messages: [{ id: 'background-title' as never, role: 'user', content: [{ type: 'text', text: 'Generate a title' }] }] })) { /* consume a non-loop helper call */ }
    assert.equal((await activity.receipts()).records.length, receipts.records.length, 'background calls with the same session id do not create memory receipts');
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loop: retired autoConsolidate flag does not run background consolidation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-loop-cons-'));
  const file = join(dir, 'user.md');
  const logPath = join(dir, 'consolidation-log.md');
  const ctx = new Context();
  let agent: Agent | undefined;
  try {
    await mountAgentLoopTestDependencies(ctx);
    const adapter = new StubAdapter();
    ctx.llm.registerAdapter(['stub'], adapter);
    ctx.on('agent/created', (entry) => {
      if ((entry as { agent?: Agent }).agent?.id?.startsWith('loop-agent-cons-')) {
        agent = (entry as { agent: Agent }).agent;
      }
    });
    await ctx.plugin(ToolUserMemory, {
      path: file,
      maxBytes: 8192,
      includeInPrompt: true,
      autoConsolidate: true,
      memoryMode: 'shared', legacyTools: true,
      consolidateMinIntervalMs: 0,
      consolidationLogPath: logPath,
      workspaceBase: join(dir, 'ws'),
    });
    await ctx.plugin(AgentLoop, {
      agents: [{ id: 'loop-agent-cons', provider: 'stub', model: 'stub-model' }],
    });

    assert.ok(await waitFor(() => agent != null), 'config agent created');
    agent!.followup({ content: '请记住我的语言偏好：中文' } as never);

    assert.ok(await waitFor(() => adapter.calls >= 2, 10000), 'normal model/tool turn completed');
    await sleep(150);
    assert.equal(existsSync(logPath), false, 'legacy automatic consolidation setting is inert');
    assert.equal(adapter.calls, 2, 'no extra model call for consolidation');
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});
