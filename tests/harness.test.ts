/**
 * Harness integration tests: mount the plugin into a real DeepSeek Harness
 * Context (via the official dsh-agent-loop-testkit), then verify tool
 * registration, tool execution through the registry, and system-prompt
 * injection — all without needing an LLM.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
  workspaceBase = '',
  workspacePromptMaxBytes = 512,
): Promise<void> {
  await ctx.plugin(ToolUserMemory, {
    path: file,
    maxBytes: 8192,
    promptMaxBytes,
    includeInPrompt,
    staleAfterDays,
    workspaceBase,
    workspacePromptMaxBytes,
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

/**
 * Minimal agent stand-in for workspace-scoped calls: the plugin resolves the
 * workspace from `agent.session.header.cwd` and reads nothing else.
 */
function fakeAgent(cwd: string): never {
  return { session: { header: { cwd } } } as never;
}

/** Execute one tool through the registry, optionally as `cwd`'s session. */
async function runTool(
  ctx: Context,
  n: number,
  name: string,
  args: Record<string, unknown>,
  cwd?: string,
) {
  return ctx.tools.execute({
    callId: callId(n),
    name,
    arguments: args,
    signal: new AbortController().signal,
    ...(cwd === undefined ? {} : { agent: fakeAgent(cwd) }),
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

test('harness: scope=workspace writes topic files for the session cwd', async () => {
  const { dir, file } = tempProfile();
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-um-hcwd-'));
  const base = join(dir, 'ws');
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file, true, 2048, 0, base);
    const result = await runTool(
      ctx,
      20,
      'memory_update',
      { key: 'build', value: 'use pnpm', scope: 'workspace' },
      cwd,
    );
    assert.equal(result.isError, false);
    const value = result.value as { ok?: boolean; scope?: string; key?: string };
    assert.equal(value.ok, true);
    assert.equal(value.scope, 'workspace');
    assert.equal(value.key, 'build');
    const hashDirs = readdirSync(base);
    assert.equal(hashDirs.length, 1, 'one directory per workspace identity');
    const wsDir = join(base, hashDirs[0]!);
    assert.ok(readFileSync(join(wsDir, 'build.md'), 'utf8').includes('use pnpm'));
    assert.ok(readFileSync(join(wsDir, 'MEMORY.md'), 'utf8').includes('## build'));
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('harness: scope=workspace without an agent fails with a clear error', async () => {
  const { dir, file } = tempProfile();
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file);
    const result = await runTool(ctx, 21, 'memory_update', { key: 'build', value: 'x', scope: 'workspace' });
    const value = result.value as { ok?: boolean; error?: string };
    assert.equal(value.ok, false);
    assert.ok(value.error?.includes('no workspace'));
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: memory_search spans global + workspace; memory_topic reads one in full', async () => {
  const { dir, file } = tempProfile();
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-um-hcwd2-'));
  const base = join(dir, 'ws');
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file, true, 2048, 0, base);
    await runUpdate(ctx, 22, 'language', 'zh-CN');
    await runTool(
      ctx,
      23,
      'memory_update',
      { key: 'conventions', value: 'run pnpm test before commit', scope: 'workspace' },
      cwd,
    );

    const globalHit = await runTool(ctx, 24, 'memory_search', { query: 'zh-CN' }, cwd);
    const gv = globalHit.value as { results?: Array<{ scope: string; topic: string }> };
    assert.deepEqual(
      gv.results?.map((r) => `${r.scope}:${r.topic}`),
      ['global:language'],
    );

    const wsHit = await runTool(ctx, 25, 'memory_search', { query: 'pnpm' }, cwd);
    const sv = wsHit.value as { results?: Array<{ scope: string; topic: string; snippet: string }> };
    assert.deepEqual(
      sv.results?.map((r) => `${r.scope}:${r.topic}`),
      ['workspace:conventions'],
    );
    assert.ok(sv.results?.[0]?.snippet.includes('pnpm'));

    const topic = await runTool(ctx, 26, 'memory_topic', { topic: 'conventions' }, cwd);
    const tv = topic.value as { ok?: boolean; body?: string };
    assert.equal(tv.ok, true);
    assert.equal(tv.body, 'run pnpm test before commit');

    const missing = await runTool(ctx, 27, 'memory_topic', { topic: 'nope' }, cwd);
    assert.equal((missing.value as { ok?: boolean }).ok, false);
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('harness: workspace memory index is injected only for agent assemblies', async () => {
  const { dir, file } = tempProfile();
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-um-hcwd3-'));
  const base = join(dir, 'ws');
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file, true, 2048, 0, base);
    await runTool(
      ctx,
      30,
      'memory_update',
      { key: 'conventions', value: 'run pnpm test before commit', scope: 'workspace' },
      cwd,
    );

    const withoutAgent = renderPrompt(await ctx.systemPrompt.assemble());
    assert.ok(!withoutAgent.includes('workspace memory index'), 'no agent = no workspace section');

    const withAgent = renderPrompt(
      await ctx.systemPrompt.assemble({ agent: fakeAgent(cwd) } as never),
    );
    assert.ok(withAgent.includes('Current workspace memory index'));
    assert.ok(withAgent.includes('## conventions'));
    assert.ok(withAgent.includes('run pnpm test before commit'));
    assert.ok(withAgent.includes('memory_topic'), 'points at the lazy full-text tool');

    const otherCwd = mkdtempSync(join(tmpdir(), 'dsh-um-hcwd4-'));
    try {
      const otherAgent = renderPrompt(
        await ctx.systemPrompt.assemble({ agent: fakeAgent(otherCwd) } as never),
      );
      assert.ok(!otherAgent.includes('## conventions'), 'other workspace sees no memory');
    } finally {
      rmSync(otherCwd, { recursive: true, force: true });
    }
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('harness: workspacePromptMaxBytes=0 disables workspace injection', async () => {
  const { dir, file } = tempProfile();
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-um-hcwd5-'));
  const base = join(dir, 'ws');
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    await mountProfile(ctx, file, true, 2048, 0, base, 0);
    await runTool(
      ctx,
      31,
      'memory_update',
      { key: 'conventions', value: 'run pnpm test', scope: 'workspace' },
      cwd,
    );
    const rendered = renderPrompt(await ctx.systemPrompt.assemble({ agent: fakeAgent(cwd) } as never));
    assert.ok(!rendered.includes('workspace memory index'));
  } finally {
    await disposeCtx(ctx);
    rmSync(dir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});
