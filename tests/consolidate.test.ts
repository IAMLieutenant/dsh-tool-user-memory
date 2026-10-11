/**
 * Consolidation tests: the deterministic planner, the model-answer parser, the
 * apply path (real store + workspace), and the audit log.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendConsolidationLog,
  applyPlan,
  buildConsolidationRequest,
  describeOp,
  normalizeValue,
  parseConsolidationOps,
  planDeterministic,
  proposeOpsWithModel,
  renderConsolidationOutcome,
  type ConsolidationPlan,
  type LlmLike,
} from '../src/consolidate.ts';
import { createMemoryStore } from '../src/store.ts';
import { createWorkspaceMemory } from '../src/workspace.ts';
import type { ProfileEntry } from '../src/profile.ts';
import type { WorkspaceTopic } from '../src/workspace.ts';

const NOW = '2026-06-01T00:00:00.000Z';

function entry(over: Partial<ProfileEntry> & { key: string }): ProfileEntry {
  return { value: '', updatedAt: NOW, invalidatedAt: '', invalidReason: '', ...over };
}

function topic(over: Partial<WorkspaceTopic> & { topic: string }): WorkspaceTopic {
  return { body: '', updatedAt: NOW, invalidatedAt: '', invalidReason: '', ...over };
}

function fakeLlm(chunks: string[]): LlmLike {
  return {
    stream() {
      return (async function* generate() {
        for (const text of chunks) yield { type: 'text-delta', text };
      })();
    },
  };
}

test('normalizeValue ignores case and whitespace differences', () => {
  assert.equal(normalizeValue('  Use   PNPM\nonly '), 'use pnpm only');
});

test('consolidation: workspace duplicate is retained when its merge destination disappears', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-topic-destination-'));
  try {
    const store = createMemoryStore({ path: join(dir, 'user.md'), maxBytes: 8192 });
    const ws = await createWorkspaceMemory({ cwd: dir, baseDir: join(dir, 'base') });
    await ws.write('a', 'same', 'set');
    await ws.write('b', 'same', 'set');
    const plan = planDeterministic({ entries: [], topics: await ws.list(), now: NOW });
    const op = plan.ops.find((op) => op.op === 'topic-invalidate');
    assert.ok(op?.op === 'topic-invalidate' && op.into);
    await ws.write(op.into, '', 'remove');
    const record = await applyPlan(store, ws, plan, 'manual');
    assert.equal(record.applied.length, 0);
    assert.equal((await ws.read(op.topic))?.invalidatedAt, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('consolidation: an apply with all operations skipped is reported as applied mode', () => {
  const rendered = renderConsolidationOutcome({
    mode: 'apply', plan: { ops: [{ op: 'rewrite', key: 'plan', value: 'old' }], notes: [] },
    record: { at: NOW, source: 'manual', applied: [], skipped: [{ op: 'rewrite(plan)', reason: 'changed since planning' }], notes: [] },
  });
  assert.ok(rendered.includes('0 op(s) applied, 1 skipped'));
  assert.ok(!rendered.includes('plan only'));
});

test('audit log retains every concurrent run and writes the header once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-log-concurrent-'));
  try {
    const logPath = join(dir, 'log.md');
    await Promise.all(Array.from({ length: 20 }, (_, i) => appendConsolidationLog(logPath, {
      at: `run-${i}`, source: 'manual', applied: [], skipped: [], notes: [],
    })));
    const log = readFileSync(logPath, 'utf8');
    assert.equal(log.split('# Consolidation Log').length - 1, 1);
    for (let i = 0; i < 20; i++) assert.ok(log.includes(`## run-${i} — manual`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('consolidation: an old rewrite plan cannot overwrite a newer user update', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-plan-conflict-'));
  try {
    const store = createMemoryStore({ path: join(dir, 'user.md'), maxBytes: 8192 });
    await store.update('plan', 'tomorrow I ship', 'set');
    const plan = planDeterministic({ entries: await store.list(), now: NOW });
    await store.update('plan', 'release cancelled', 'set');
    const record = await applyPlan(store, null, plan, 'manual');
    assert.equal(record.applied.length, 0);
    assert.ok(record.skipped[0]?.reason.includes('changed since'));
    assert.equal((await store.list())[0]?.value, 'release cancelled');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('consolidation: duplicate relative dates stay retired in a single pass', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-duplicate-date-'));
  try {
    const store = createMemoryStore({ path: join(dir, 'user.md'), maxBytes: 8192 });
    await store.update('old-plan', 'tomorrow I ship', 'set');
    await store.update('new-plan', 'tomorrow I ship', 'set');
    const plan = planDeterministic({ entries: await store.list(), now: NOW });
    await applyPlan(store, null, plan, 'manual');
    const after = await store.list();
    assert.equal(after.filter((e) => !e.invalidatedAt).length, 1);
    assert.equal(after.filter((e) => e.invalidatedAt).length, 1);
    assert.ok(after.find((e) => !e.invalidatedAt)?.value.includes('(recorded '));
    assert.equal(planDeterministic({ entries: after, now: NOW }).ops.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('consolidation: retirement wins over conflicting rewrites, and a content edit never revives', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-retirement-'));
  try {
    const store = createMemoryStore({ path: join(dir, 'user.md'), maxBytes: 8192 });
    await store.update('plan', 'tomorrow I ship', 'set');
    const record = await applyPlan(store, null, {
      ops: [{ op: 'rewrite', key: 'plan', value: 'rewritten' }, { op: 'invalidate', key: 'plan', reason: 'cancelled' }],
      notes: [], profileSnapshot: await store.list(),
    }, 'manual');
    assert.equal(record.applied.length, 1);
    assert.equal(record.skipped.length, 1);
    await store.rewrite('plan', 'formatting edit');
    assert.ok((await store.list())[0]?.invalidatedAt);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('consolidation: a merge checks its destination and add cannot overwrite an existing key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-merge-conflict-'));
  try {
    const store = createMemoryStore({ path: join(dir, 'user.md'), maxBytes: 8192 });
    await store.update('a', 'same', 'set');
    await store.update('b', 'same', 'set');
    const snapshot = await store.list();
    await store.update('b', '', 'remove');
    const record = await applyPlan(store, null, {
      ops: [{ op: 'merge', key: 'a', into: 'b' }, { op: 'add', key: 'a', value: 'model overwrite' }],
      notes: [], profileSnapshot: snapshot,
    }, 'manual');
    assert.equal(record.applied.length, 0);
    assert.equal(record.skipped.length, 2);
    assert.equal((await store.list())[0]?.value, 'same');
    assert.equal((await store.list())[0]?.invalidatedAt, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('consolidation: workspace invalidation cannot retire a topic updated after planning', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-workspace-conflict-'));
  try {
    const store = createMemoryStore({ path: join(dir, 'user.md'), maxBytes: 8192 });
    const ws = await createWorkspaceMemory({ cwd: dir, baseDir: join(dir, 'base') });
    await ws.write('a', 'same', 'set');
    await ws.write('b', 'same', 'set');
    const plan = planDeterministic({ entries: [], topics: await ws.list(), now: NOW });
    const retirement = plan.ops.find((op) => op.op === 'topic-invalidate');
    assert.ok(retirement?.op === 'topic-invalidate');
    await ws.write(retirement.topic, 'new project instructions', 'set');
    const record = await applyPlan(store, ws, plan, 'manual');
    assert.equal(record.applied.length, 0);
    assert.ok(record.skipped[0]?.reason.includes('changed since'));
    assert.equal((await ws.read(retirement.topic))?.invalidatedAt, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('planDeterministic merges duplicates (newest wins) and anchors relative dates once', () => {
  const entries = [
    entry({ key: 'project', value: 'rag-service', updatedAt: '2026-05-01T00:00:00.000Z' }),
    entry({ key: 'project-v2', value: 'RAG-Service ', updatedAt: '2026-05-20T00:00:00.000Z' }),
    entry({ key: 'plan', value: 'tomorrow I ship the release', updatedAt: '2026-05-30T00:00:00.000Z' }),
    entry({ key: 'anchored', value: 'today: deploy\n(recorded 2026-05-01; relative dates refer to this date)' }),
  ];
  const plan = planDeterministic({ entries, now: NOW });
  assert.deepEqual(
    plan.ops.map(describeOp),
    ['merge(project → project-v2)', 'rewrite(plan)'],
  );
  const merge = plan.ops[0]!;
  assert.equal(merge.op === 'merge' ? merge.reason : '', "same value as 'project-v2'");
  const rewrite = plan.ops[1]!;
  assert.equal(
    rewrite.op === 'rewrite' ? rewrite.value : '',
    'tomorrow I ship the release\n(recorded 2026-05-30; relative dates refer to this date)',
  );
});

test('planDeterministic reports aging candidates and honours autoInvalidateAfterDays', () => {
  const entries = [
    entry({ key: 'fresh', value: 'v', updatedAt: '2026-05-30T00:00:00.000Z' }),
    entry({ key: 'old', value: 'v2', updatedAt: '2026-01-01T00:00:00.000Z' }),
  ];
  const report = planDeterministic({ entries, now: NOW, staleAfterDays: 30 });
  assert.deepEqual(report.ops, []);
  assert.ok(report.notes.some((n) => n.includes('aging candidates: old (151d)')));

  const auto = planDeterministic({ entries, now: NOW, autoInvalidateAfterDays: 90 });
  assert.deepEqual(
    auto.ops.map(describeOp),
    ['invalidate(old)'],
  );
  assert.equal(auto.ops[0]!.op === 'invalidate' ? auto.ops[0]!.reason : '', 'not confirmed for 151 days (auto-aging)');
});

test('planDeterministic merges duplicate workspace topics by identical body', () => {
  const topics = [
    topic({ topic: 'build', body: 'use pnpm', updatedAt: '2026-05-01T00:00:00.000Z' }),
    topic({ topic: 'build-notes', body: 'Use  PNPM', updatedAt: '2026-05-20T00:00:00.000Z' }),
    topic({ topic: 'dead', body: 'use pnpm', invalidatedAt: NOW }),
  ];
  const plan = planDeterministic({ entries: [], topics, now: NOW });
  assert.deepEqual(
    plan.ops.map(describeOp),
    ['topic-invalidate(build)'],
  );
});

test('parseConsolidationOps validates ops, tolerates fences, and drops junk', () => {
  const fenced = [
    'Sure, here is the plan:',
    '```json',
    '{"ops":[',
    '{"op":"add","key":"timezone","value":"UTC+8"},',
    '{"op":"merge","key":"dup","into":"kept"},',
    '{"op":"merge","key":"same","into":"same"},',
    '{"op":"nonsense","key":"x"},',
    '{"op":"invalidate","key":""},',
    '{"op":"topic-add","topic":"build","body":"use pnpm"}',
    ']}',
    '```',
  ].join('\n');
  const parsed = parseConsolidationOps(fenced);
  assert.deepEqual(
    parsed.ops.map(describeOp),
    ['add(timezone)', 'merge(dup → kept)', 'topic-add(build)'],
  );
  assert.equal(parsed.dropped, 3);
  assert.equal(parsed.error, undefined);

  assert.ok(parseConsolidationOps('no json here').error?.includes('no JSON object'));
  assert.ok(parseConsolidationOps('{ "ops": [ ').error?.includes('invalid JSON'));
  assert.ok(parseConsolidationOps('{"plan":[]}').error?.includes('missing "ops"'));
});

test('buildConsolidationRequest embeds the memory and the op contract', () => {
  const request = buildConsolidationRequest({
    entries: [entry({ key: 'language', value: 'zh-CN' })],
    topics: [topic({ topic: 'build', body: 'use pnpm' })],
    now: NOW,
  });
  assert.ok(request.system.includes('"op":"invalidate"'));
  assert.ok(request.user.includes('"language"'));
  assert.ok(request.user.includes('"build"'));
  assert.ok(request.user.includes(NOW));
});

test('proposeOpsWithModel streams the answer, and degrades on model failure', async () => {
  const ok = await proposeOpsWithModel(
    fakeLlm(['```json\n{"ops":[{"op":"invalidate","key":"old","reason":"done"}]}\n```']),
    { provider: 'stub', model: 'stub-model' },
    { entries: [], topics: [], now: NOW },
  );
  assert.deepEqual(
    ok.ops.map(describeOp),
    ['invalidate(old)'],
  );
  assert.equal(ok.error, undefined);

  const failing: LlmLike = {
    stream() {
      return (async function* generate(): AsyncGenerator<{ type?: string; text?: string }> {
        throw new Error('boom');
        // eslint-disable-next-line no-unreachable
        yield { type: 'text-delta', text: '' };
      })();
    },
  };
  const failed = await proposeOpsWithModel(failing, { provider: 'stub', model: 'stub-model' }, {
    entries: [],
    topics: [],
    now: NOW,
  });
  assert.deepEqual(failed.ops, []);
  assert.ok(failed.error?.includes('boom'));
});

test('applyPlan writes through the store, is idempotent, and logs an auditable record', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-cons-'));
  try {
    const store = createMemoryStore({ path: join(dir, 'user.md'), maxBytes: 8192 });
    await store.update('project', 'rag-service', 'set');
    await store.update('project-v2', 'rag-service', 'set');
    await store.update('plan', 'tomorrow I ship the release', 'set');

    const plan = planDeterministic({ entries: await store.list(), now: new Date().toISOString() });
    const labels = plan.ops.map(describeOp);
    assert.equal(plan.ops.length, 2, 'one duplicate retired + one date anchored');
    assert.equal(labels.filter((l) => l.startsWith('merge(')).length, 1);
    assert.deepEqual(
      labels.filter((l) => l.startsWith('rewrite(')),
      ['rewrite(plan)'],
    );

    const record = await applyPlan(store, null, plan, 'manual');
    assert.equal(record.source, 'manual');
    assert.equal(record.applied.length, plan.ops.length);

    const after = await store.list();
    const alive = after.filter((e) => e.invalidatedAt === '' && e.value === 'rag-service');
    const dead = after.filter((e) => e.invalidatedAt !== '' && e.value === 'rag-service');
    assert.equal(alive.length, 1, 'exactly one duplicate survives');
    assert.equal(dead.length, 1, 'exactly one duplicate is retired');
    assert.ok(dead[0]!.invalidReason.includes('same value as'));
    const anchored = after.find((e) => e.key === 'plan');
    assert.ok(anchored!.value.includes('(recorded '), 'relative date anchored');

    // Second pass: nothing left to do (idempotent).
    const again = planDeterministic({ entries: await store.list(), now: new Date().toISOString() });
    assert.deepEqual(again.ops, []);

    const logPath = join(dir, 'consolidation-log.md');
    await appendConsolidationLog(logPath, record);
    const log = readFileSync(logPath, 'utf8');
    assert.ok(log.startsWith('# Consolidation Log'));
    assert.ok(log.includes('## '));
    assert.ok(log.includes('— manual'));
    assert.ok(log.includes('merge('));
    assert.ok(log.includes('rewrite('));
    assert.ok(log.includes('applied (2)'));

    // Appending a second record keeps the earlier one.
    await appendConsolidationLog(logPath, { ...record, at: '2026-06-02T00:00:00.000Z', source: 'turn' });
    const log2 = readFileSync(logPath, 'utf8');
    assert.ok(log2.includes('— manual'));
    assert.ok(log2.includes('— turn'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyPlan: rewrite keeps the entry age while add refreshes it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-cons5-'));
  try {
    const file = join(dir, 'user.md');
    await writeFile(
      file,
      '# User Memory\n\n## plan\n<!-- ts: 2026-01-01T00:00:00.000Z -->\ntomorrow I ship the release\n',
      'utf8',
    );
    const store = createMemoryStore({ path: file, maxBytes: 8192 });
    const before = (await store.list())[0]!;
    const record = await applyPlan(
      store,
      null,
      {
        ops: [
          {
            op: 'rewrite',
            key: 'plan',
            value: `${before.value}\n(recorded 2026-01-01; relative dates refer to this date)`,
          },
          { op: 'add', key: 'fresh', value: 'recorded now' },
        ],
        notes: [],
      },
      'manual',
    );
    assert.equal(record.applied.length, 2);
    const after = await store.list();
    const rewritten = after.find((entry) => entry.key === 'plan')!;
    const added = after.find((entry) => entry.key === 'fresh')!;
    assert.equal(rewritten.updatedAt, before.updatedAt, 'a content edit never resets the age');
    assert.notEqual(added.updatedAt, before.updatedAt, 'a new entry is stamped now');
    assert.ok(rewritten.value.includes('(recorded '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyPlan applies workspace ops through the workspace store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-cons2-'));
  try {
    const store = createMemoryStore({ path: join(dir, 'user.md'), maxBytes: 8192 });
    const base = join(dir, 'ws-base');
    const ws = await createWorkspaceMemory({ cwd: dir, baseDir: base });
    const plan: ConsolidationPlan = {
      ops: [
        { op: 'topic-add', topic: 'build', body: 'use pnpm' },
        { op: 'topic-invalidate', topic: 'ghost', reason: 'x' },
      ],
      notes: [],
    };
    const record = await applyPlan(store, ws, plan, 'turn', ws.path);
    assert.equal(record.workspace, ws.path);
    assert.deepEqual(
      record.applied.map(describeOp),
      ['topic-add(build)'],
    );
    assert.equal(record.skipped.length, 1);
    assert.ok(record.skipped[0]!.reason.includes('does not exist'));
    assert.equal((await ws.read('build'))?.body, 'use pnpm');
    assert.ok(!(await ws.indexText()).includes('ghost'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyPlan skips workspace ops when the session has no workspace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-cons3-'));
  try {
    const store = createMemoryStore({ path: join(dir, 'user.md'), maxBytes: 8192 });
    const record = await applyPlan(
      store,
      null,
      { ops: [{ op: 'topic-add', topic: 'build', body: 'x' }], notes: [] },
      'turn',
    );
    assert.deepEqual(record.applied, []);
    assert.ok(record.skipped[0]!.reason.includes('no workspace memory'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderConsolidationOutcome summarises plans, applications, and model errors', () => {
  const plan: ConsolidationPlan = {
    ops: [{ op: 'merge', key: 'dup', into: 'kept', reason: 'same value' }],
    notes: ['aging candidates: old (99d)'],
  };
  const planned = renderConsolidationOutcome({
    plan,
    record: { at: NOW, source: 'manual', applied: [], skipped: [], notes: plan.notes },
  });
  assert.ok(planned.includes('1 op(s) proposed'));
  assert.ok(planned.includes('merge(dup → kept) — same value'));
  assert.ok(planned.includes('note: aging candidates'));

  const applied = renderConsolidationOutcome({
    plan,
    record: { at: NOW, source: 'turn', applied: plan.ops, skipped: [], notes: [] },
  });
  assert.ok(applied.includes('1 op(s) applied, 0 skipped'));

  const empty = renderConsolidationOutcome({
    plan: { ops: [], notes: [] },
    record: { at: NOW, source: 'manual', applied: [], skipped: [], notes: [] },
    modelError: 'no consolidation model configured',
  });
  assert.ok(empty.includes('nothing to consolidate'));
  assert.ok(empty.includes('model: no consolidation model configured'));
});

test('planDeterministic ignores invalidated entries and untimestamped values', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-cons4-'));
  try {
    await writeFile(
      join(dir, 'user.md'),
      '# User Memory\n\n## handedited\nno timestamp here\n\n## dead\n<!-- ts: 2026-01-01T00:00:00.000Z -->\n<!-- invalid: 2026-02-01T00:00:00.000Z | gone -->\nsame value\n\n## alive\n<!-- ts: 2026-01-01T00:00:00.000Z -->\nsame value\n',
      'utf8',
    );
    const store = createMemoryStore({ path: join(dir, 'user.md'), maxBytes: 8192 });
    const plan = planDeterministic({ entries: await store.list(), now: NOW, autoInvalidateAfterDays: 30 });
    assert.deepEqual(
      plan.ops.map(describeOp),
      ['invalidate(alive)'],
      'only still-valid entries with a timestamp are considered',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
