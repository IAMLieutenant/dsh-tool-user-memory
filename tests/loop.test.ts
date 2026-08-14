/**
 * Loop-level test: mount the FULL agent loop (dsh-agent-loop) with a scripted
 * stub LLM adapter, let a real agent decide to call `memory_update`, and verify
 * the preference is persisted and the loop completes both turns.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
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
    await ctx.plugin(ToolUserMemory, { path: file, maxBytes: 8192, includeInPrompt: true });
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
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});
