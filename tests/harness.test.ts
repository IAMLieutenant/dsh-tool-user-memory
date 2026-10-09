/**
 * Harness integration tests: mount the plugin into a real DeepSeek Harness
 * Context (via the official dsh-agent-loop-testkit), then verify tool
 * registration, tool execution through the registry, and system-prompt
 * injection — all without needing an LLM.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit';
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import type { CallId } from '@deepseek-ai/dsh-llm';
import * as ToolUserMemory from '../src/index.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tempProfile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-harness-'));
  return { dir, file: join(dir, 'user.md') };
}

function callId(n: number): CallId {
  return `test-call-${n}` as CallId;
}

/** Teardown a cordis Context: fiber.dispose() unloads all mounted plugins. */
async function disposeCtx(ctx: Context): Promise<void> {
  const fiber = (ctx as unknown as { fiber?: { dispose?: () => Promise<unknown> | void } }).fiber;
  if (fiber?.dispose) await fiber.dispose();
}

async function mountProfile(
  ctx: Context,
  file: string,
  includeInPrompt = true,
  promptMaxBytes = 2048,
  staleAfterDays = 0,
): Promise<void> {
  await ctx.plugin(ToolUserMemory, {
    path: file,
    maxBytes: 8192,
    promptMaxBytes,
    includeInPrompt,
    staleAfterDays,
  });
}

async function runUpdate(
  ctx: Context,
  n: number,
  key: string,
  value: string,
  mode?: string,
  reason?: string,
) {
  const toolArgs: Record<string, string> = { key, value };
  if (mode !== undefined) toolArgs.mode = mode;
  if (reason !== undefined) toolArgs.reason = reason;
  return ctx.tools.execute({
    callId: callId(n),
    name: 'memory_update',
    arguments: toolArgs,
    signal: new AbortController().signal,
  });
}

test('harness: plugin mounts and registers memory_get / memory_update', async () => {
  const { dir, file } = tempProfile();
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file);
    assert.ok(ctx.tools.get('memory_get'), 'memory_get registered');
    assert.ok(ctx.tools.get('memory_update'), 'memory_update registered');
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: memory_update executes through the registry and persists', async () => {
  const { dir, file } = tempProfile();
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file);
    const result = await runUpdate(ctx, 1, 'language', 'zh-CN', 'set');
    assert.equal(result.isError, false);
    const value = result.value as { ok?: boolean; key?: string };
    assert.equal(value.ok, true);
    assert.equal(value.key, 'language');
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes('## language'));
    assert.ok(text.includes('zh-CN'));
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: memory_get returns the rendered profile', async () => {
  const { dir, file } = tempProfile();
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file);
    await runUpdate(ctx, 2, 'style', 'concise');
    const result = await ctx.tools.execute({
      callId: callId(3),
      name: 'memory_get',
      arguments: {},
      signal: new AbortController().signal,
    });
    assert.equal(result.isError, false);
    const value = result.value as { total?: number; rendered?: string };
    assert.equal(value.total, 1);
    assert.ok(value.rendered?.includes('concise'));
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: profile is injected into the assembled system prompt', async () => {
  const { dir, file } = tempProfile();
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file);
    await runUpdate(ctx, 4, 'communication-style', 'concise');
    const assembly = await ctx.systemPrompt.assemble();
    const rendered = renderPrompt(assembly);
    assert.ok(rendered.includes('Current user profile'));
    assert.ok(rendered.includes('concise'));
    assert.ok(rendered.includes('NOT instructions'));
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: empty profile adds no user-memory section (zero token cost)', async () => {
  const { dir, file } = tempProfile();
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file);
    const assembly = await ctx.systemPrompt.assemble();
    const rendered = renderPrompt(assembly);
    assert.ok(!rendered.includes('Current user profile'));
    assert.ok(!rendered.includes('user:memory'));
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: includeInPrompt=false keeps tools but skips injection', async () => {
  const { dir, file } = tempProfile();
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file, false);
    assert.ok(ctx.tools.get('memory_update'), 'tool still registered');
    await runUpdate(ctx, 5, 'x', 'y');
    const assembly = await ctx.systemPrompt.assemble();
    const rendered = renderPrompt(assembly);
    assert.ok(!rendered.includes('Current user profile'));
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: prompt injection is budget-capped, newest entries first', async () => {
  const { dir, file } = tempProfile();
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file, true, 100);
    await runUpdate(ctx, 6, 'older', 'o'.repeat(200));
    await sleep(25); // ensure a distinct per-entry timestamp
    await runUpdate(ctx, 7, 'newer', 'n'.repeat(200));
    const assembly = await ctx.systemPrompt.assemble();
    const rendered = renderPrompt(assembly);
    assert.ok(rendered.includes('## newer'));
    assert.ok(!rendered.includes('## older'));
    assert.ok(rendered.includes('memory_get')); // note points at the full profile
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: invalidated entries leave the prompt but stay auditable via includeStale', async () => {
  const { dir, file } = tempProfile();
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file);
    await runUpdate(ctx, 10, 'project', 'rag-service', 'set');
    await runUpdate(ctx, 11, 'project', '', 'invalidate', 'superseded by agent-platform');
    const rendered = renderPrompt(await ctx.systemPrompt.assemble());
    assert.ok(!rendered.includes('rag-service'), 'invalidated value hidden from prompt');
    const hidden = await ctx.tools.execute({
      callId: callId(12),
      name: 'memory_get',
      arguments: {},
      signal: new AbortController().signal,
    });
    const hv = hidden.value as { rendered?: string; invalidated?: number };
    assert.equal(hv.invalidated, 1);
    assert.ok(!hv.rendered?.includes('rag-service'), 'hidden from memory_get by default');
    const shown = await ctx.tools.execute({
      callId: callId(13),
      name: 'memory_get',
      arguments: { includeStale: true },
      signal: new AbortController().signal,
    });
    const sv = shown.value as { rendered?: string };
    assert.ok(sv.rendered?.includes('rag-service'), 'includeStale returns the entry');
    assert.ok(sv.rendered?.includes('[invalidated'), 'entry is clearly marked');
    assert.ok(sv.rendered?.includes('superseded by agent-platform'), 'reason is shown');
    await runUpdate(ctx, 14, 'project', 'agent-platform', 'set');
    const rendered2 = renderPrompt(await ctx.systemPrompt.assemble());
    assert.ok(rendered2.includes('agent-platform'), 'set revives the entry into the prompt');
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: staleAfterDays annotates old entries in the prompt', async () => {
  const { dir, file } = tempProfile();
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file, true, 2048, 30);
    const oldTs = new Date(Date.now() - 60 * 86_400_000).toISOString();
    await writeFile(file, `# User Memory\n\n## old-fact\n<!-- ts: ${oldTs} -->\nmaybe still true\n`, 'utf8');
    const rendered = renderPrompt(await ctx.systemPrompt.assemble());
    assert.ok(rendered.includes('## old-fact [stale: last updated 60d ago]'));
    assert.ok(rendered.includes('maybe still true'));
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});
