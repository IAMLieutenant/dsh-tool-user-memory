/**
 * Background consolidation ("dreaming"): review recorded memory, merge
 * duplicates, anchor relative time references, retire what stopped being true,
 * and append an auditable Markdown record of every run.
 *
 * Two layers, both opt-in:
 *   - deterministic: pure rules (duplicates, relative-time anchoring, aging) —
 *     no model, runs in milliseconds
 *   - model-assisted: when a provider/model is configured, one background call
 *     proposes ops (add / merge / rewrite / invalidate / topic-*) that are
 *     validated, applied through the same path, and logged. A malformed or
 *     unavailable model answer degrades to the deterministic plan.
 *
 * Everything funnels through `ConsolidationOp`, so the deterministic planner,
 * the model proposal, the tool trigger, and the turn-boundary trigger all
 * share one apply path and one log format.
 */

import { promises as fsp } from 'node:fs';
import * as nodePath from 'node:path';
import type { ProfileEntry } from './profile.ts';
import type { MemoryStore, MemoryMutationGuard } from './store.ts';
import type { WorkspaceMemory, WorkspaceTopic } from './workspace.ts';
import { withDocumentLock } from './lock.ts';

export type ConsolidationOp =
  | { op: 'add'; key: string; value: string }
  | { op: 'rewrite'; key: string; value: string; reason?: string }
  | { op: 'invalidate'; key: string; reason: string }
  | { op: 'merge'; key: string; into: string; reason?: string }
  | { op: 'topic-add'; topic: string; body: string }
  | { op: 'topic-invalidate'; topic: string; reason: string; into?: string };

export interface ConsolidationPlan {
  ops: ConsolidationOp[];
  /** What was considered but not turned into an op (aging candidates, …). */
  notes: string[];
  /** Original facts used to plan; every write checks its target under the lock. */
  profileSnapshot?: ProfileEntry[];
  workspaceSnapshot?: WorkspaceTopic[];
}

export interface ConsolidationRecord {
  at: string;
  /** What asked for this run. */
  source: 'manual' | 'turn' | 'idle';
  /** Canonical workspace path when the run covered workspace memory. */
  workspace?: string;
  applied: ConsolidationOp[];
  skipped: { op: string; reason: string }[];
  notes: string[];
}

/** Marker appended by the time-anchoring rule; its presence means "already anchored". */
const ANCHOR_MARK = '(recorded ';

const RELATIVE_TIME = new RegExp(
  [
    '\\b(?:today|tomorrow|yesterday|tonight|this (?:week|month)|next (?:week|month)|last (?:week|month))\\b',
    '(?:今天|明天|昨天|后天|前天|今晚|本周|这周|上周|下周|这个月|下个月|上个月|接下来)',
  ].join('|'),
  'i',
);

const DAY_MS = 86_400_000;

/** Normalize a value for duplicate detection: case- and whitespace-insensitive. */
export function normalizeValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function ageDays(entry: { updatedAt: string }, now: string): number | null {
  const base = Date.parse(entry.updatedAt);
  const at = Date.parse(now);
  if (Number.isNaN(base) || Number.isNaN(at)) return null;
  return Math.floor((at - base) / DAY_MS);
}

function anchorDate(entry: { updatedAt: string }, now: string): string {
  const base = Date.parse(entry.updatedAt);
  const iso = Number.isNaN(base) ? now : new Date(base).toISOString();
  return iso.slice(0, 10);
}

export interface DeterministicInput {
  entries: ProfileEntry[];
  topics?: WorkspaceTopic[];
  now: string;
  /** Entries not updated for this many days are reported as candidates (0 = off). */
  staleAfterDays?: number;
  /** Entries not updated for this many days are invalidated automatically (0 = off). */
  autoInvalidateAfterDays?: number;
}

/**
 * Deterministic consolidation plan:
 *   1. duplicate values → keep the newest entry, invalidate the rest
 *   2. relative time references → append an absolute recording date once
 *   3. aging → report stale candidates, and invalidate past `autoInvalidateAfterDays`
 *   4. workspace topics → duplicate bodies merged the same way
 */
export function planDeterministic(input: DeterministicInput): ConsolidationPlan {
  const now = input.now;
  const staleAfterDays = input.staleAfterDays ?? 0;
  const autoInvalidateAfterDays = input.autoInvalidateAfterDays ?? 0;
  const ops: ConsolidationOp[] = [];
  const notes: string[] = [];

  const valid = input.entries.filter((e) => e.invalidatedAt === '');

  // 1. duplicates (newest wins; ties keep the first occurrence)
  const byValue = new Map<string, ProfileEntry[]>();
  for (const entry of valid) {
    const key = normalizeValue(entry.value);
    if (key === '') continue;
    const bucket = byValue.get(key);
    if (bucket === undefined) byValue.set(key, [entry]);
    else bucket.push(entry);
  }
  for (const bucket of byValue.values()) {
    if (bucket.length < 2) continue;
    const sorted = bucket.slice().sort((a, b) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1));
    const keep = sorted[0]!;
    for (const entry of sorted.slice(1)) {
      ops.push({
        op: 'merge',
        key: entry.key,
        into: keep.key,
        reason: `same value as '${keep.key}'`,
      });
    }
  }

  // 2. relative-time anchoring (append once, never rewrite the user's own words)
  const retired = new Set(ops.filter((op) => op.op === 'merge').map((op) => op.key));
  for (const entry of valid) {
    if (retired.has(entry.key)) continue;
    if (!RELATIVE_TIME.test(entry.value)) continue;
    if (entry.value.includes(ANCHOR_MARK)) continue;
    ops.push({
      op: 'rewrite',
      key: entry.key,
      value: `${entry.value}\n${ANCHOR_MARK}${anchorDate(entry, now)}; relative dates refer to this date)`,
      reason: 'relative time anchored',
    });
  }

  // 3. aging
  const stale: string[] = [];
  for (const entry of valid) {
    const age = ageDays(entry, now);
    if (age === null) continue;
    if (autoInvalidateAfterDays > 0 && age > autoInvalidateAfterDays) {
      ops.push({
        op: 'invalidate',
        key: entry.key,
        reason: `not confirmed for ${age} days (auto-aging)`,
      });
      continue;
    }
    if (staleAfterDays > 0 && age > staleAfterDays) stale.push(`${entry.key} (${age}d)`);
  }
  if (stale.length > 0) notes.push(`aging candidates: ${stale.join(', ')}`);

  // 4. workspace topic duplicates
  const topics = (input.topics ?? []).filter((t) => t.invalidatedAt === '');
  const byBody = new Map<string, WorkspaceTopic[]>();
  for (const topic of topics) {
    const key = normalizeValue(topic.body);
    if (key === '') continue;
    const bucket = byBody.get(key);
    if (bucket === undefined) byBody.set(key, [topic]);
    else bucket.push(topic);
  }
  for (const bucket of byBody.values()) {
    if (bucket.length < 2) continue;
    const sorted = bucket.slice().sort((a, b) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1));
    const keep = sorted[0]!;
    for (const topic of sorted.slice(1)) {
      ops.push({
        op: 'topic-invalidate',
        topic: topic.topic,
        into: keep.topic,
        reason: `same content as topic '${keep.topic}'`,
      });
    }
  }

  return { ops, notes, profileSnapshot: input.entries.map((entry) => ({ ...entry })), workspaceSnapshot: (input.topics ?? []).map((topic) => ({ ...topic })) };
}

/** The one place ops turn into writes. Never throws: failures land in `skipped`. */
export async function applyPlan(
  store: MemoryStore,
  ws: WorkspaceMemory | null,
  plan: ConsolidationPlan,
  source: ConsolidationRecord['source'],
  workspacePath?: string,
): Promise<ConsolidationRecord> {
  const record: ConsolidationRecord = {
    at: new Date().toISOString(),
    source,
    ...(workspacePath === undefined ? {} : { workspace: workspacePath }),
    applied: [],
    skipped: [],
    notes: plan.notes,
  };
  const entries = plan.profileSnapshot ?? await store.list();
  const topics = plan.workspaceSnapshot ?? (ws === null ? [] : await ws.list());
  const guardFor = (key: string): MemoryMutationGuard => ({ expected: entries.find((entry) => entry.key === key) ?? null });
  const priority = (op: ConsolidationOp): number =>
    op.op === 'invalidate' || op.op === 'merge' || op.op === 'topic-invalidate' ? 0 : 1;
  const retiring = new Set(plan.ops.filter((op) => op.op === 'invalidate' || op.op === 'merge').map((op) => op.key));
  const retiringTopics = new Set(plan.ops.filter((op) => op.op === 'topic-invalidate').map((op) => op.topic.toLowerCase()));
  const touched = new Set<string>();
  // Retirement wins over content edits. A plan may mutate each target once;
  // conflicting model proposals are skipped rather than silently undoing an op.
  for (const op of plan.ops.slice().sort((a, b) => priority(a) - priority(b))) {
    const fail = async (reason: string): Promise<void> => {
      record.skipped.push({ op: describeOp(op), reason });
    };
    const target = 'key' in op ? `global:${op.key}` : `workspace:${op.topic.toLowerCase()}`;
    if (touched.has(target)) {
      await fail('conflicting operation for a target already changed by this plan');
      continue;
    }
    const appliedBefore = record.applied.length;
    switch (op.op) {
      case 'add': {
        if (entries.some((entry) => entry.key === op.key)) {
          await fail('add requires a new key; use rewrite to edit an existing memory');
          break;
        }
        const result = await store.update(op.key, op.value, 'set', '', guardFor(op.key));
        if (result.ok) record.applied.push(op);
        else await fail(result.error ?? 'update rejected');
        break;
      }
      case 'rewrite': {
        // A content edit must not refresh the entry's timestamp: doing so would
        // reset its age and silently defeat staleAfterDays and
        // autoInvalidateAfterDays.
        const result = await store.rewrite(op.key, op.value, guardFor(op.key));
        if (result.ok) record.applied.push(op);
        else await fail(result.error ?? 'rewrite rejected');
        break;
      }
      case 'invalidate':
      case 'merge': {
        const reason = op.op === 'merge' ? (op.reason ?? `merged into '${op.into}'`) : op.reason;
        const guard = guardFor(op.key);
        if (op.op === 'merge') {
          const destination = entries.find((entry) => entry.key === op.into);
          if (destination === undefined || destination.invalidatedAt !== '' || retiring.has(op.into)) {
            await fail('merge destination must be an existing valid entry kept by this plan');
            break;
          }
          guard.dependency = destination;
        }
        const result = await store.update(op.key, '', 'invalidate', reason, guard);
        if (result.ok) record.applied.push(op);
        else await fail(result.error ?? 'invalidate rejected');
        break;
      }
      case 'topic-add': {
        if (ws === null) {
          await fail('no workspace memory for this session');
          break;
        }
        if (topics.some((topic) => topic.topic.toLowerCase() === op.topic.toLowerCase())) {
          await fail('topic-add requires a new topic');
          break;
        }
        const result = await ws.write(op.topic, op.body, 'set', '', null);
        if (result.ok) record.applied.push(op);
        else await fail(result.error ?? 'topic write rejected');
        break;
      }
      case 'topic-invalidate': {
        if (ws === null) {
          await fail('no workspace memory for this session');
          break;
        }
        const expected = topics.find((topic) => topic.topic.toLowerCase() === op.topic.toLowerCase()) ?? null;
        const destination = op.into === undefined ? undefined : topics.find((topic) => topic.topic === op.into);
        if (op.into !== undefined && (destination === undefined || destination.invalidatedAt !== '' || retiringTopics.has(op.into.toLowerCase()))) {
          await fail('merge destination must be an existing valid topic kept by this plan');
          break;
        }
        const result = await ws.write(op.topic, '', 'invalidate', op.reason, expected, destination);
        if (result.ok) record.applied.push(op);
        else await fail(result.error ?? 'topic invalidate rejected');
        break;
      }
    }
    if (record.applied.length > appliedBefore) touched.add(target);
  }
  return record;
}

/** One-line description of an op, used by logs, tool output, and skipped entries. */
export function describeOp(op: ConsolidationOp): string {
  switch (op.op) {
    case 'add':
      return `add(${op.key})`;
    case 'rewrite':
      return `rewrite(${op.key})`;
    case 'invalidate':
      return `invalidate(${op.key})`;
    case 'merge':
      return `merge(${op.key} → ${op.into})`;
    case 'topic-add':
      return `topic-add(${op.topic})`;
    case 'topic-invalidate':
      return `topic-invalidate(${op.topic})`;
  }
}

export const CONSOLIDATION_LOG_HEADER = [
  '# Consolidation Log',
  '',
  'Append-only record of background memory consolidation runs: what was merged,',
  'rewritten, or invalidated, and why. Written by dsh-tool-user-memory.',
  '',
].join('\n');

/** Append one run to the log (created on first write). */
export async function appendConsolidationLog(
  logPath: string,
  record: ConsolidationRecord,
): Promise<void> {
  const lines: string[] = [`## ${record.at} — ${record.source}`];
  if (record.workspace !== undefined) lines.push(`- workspace: ${record.workspace}`);
  if (record.applied.length > 0) {
    lines.push(`- applied (${record.applied.length}):`);
    for (const op of record.applied) {
      const reason = 'reason' in op && op.reason !== undefined && op.reason !== '' ? ` — ${op.reason}` : '';
      lines.push(`  - ${describeOp(op)}${reason}`);
    }
  } else {
    lines.push('- applied: none');
  }
  if (record.skipped.length > 0) {
    lines.push(`- skipped (${record.skipped.length}):`);
    for (const item of record.skipped) lines.push(`  - ${item.op} — ${item.reason}`);
  }
  for (const note of record.notes) lines.push(`- note: ${note}`);
  lines.push('');

  await withDocumentLock(`${logPath}.lock`, async () => {
    let size = 0;
    try {
      size = (await fsp.stat(logPath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const header = size === 0 ? CONSOLIDATION_LOG_HEADER : '';
    await fsp.appendFile(logPath, `${header}${lines.join('\n')}`, { encoding: 'utf8', mode: 0o600 });
  });
}

/** Messaging shape of the consolidation model call (structural; no dsh-llm import). */
export interface LlmLike {
  stream(options: {
    provider: string;
    model: string;
    system?: string;
    messages: { role: 'user'; content: string }[];
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): AsyncIterable<{ type?: string; text?: string }>;
}

export interface ModelProposalInput {
  entries: ProfileEntry[];
  topics: WorkspaceTopic[];
  now: string;
}

const MODEL_SYSTEM_PROMPT = [
  'You consolidate a coding agent\'s long-term memory about one user.',
  'You receive the current memory as JSON and return a JSON object of ops.',
  'Allowed ops (use only these shapes):',
  '  {"op":"add","key":"...","value":"..."}            record a durable fact that is missing',
  '  {"op":"merge","key":"dup","into":"kept","reason":"..."}   two keys carry the same fact',
  '  {"op":"rewrite","key":"...","value":"...","reason":"..."} replace a value (time rewrites: "going to" → "went")',
  '  {"op":"invalidate","key":"...","reason":"..."}    the fact stopped being true',
  '  {"op":"topic-add","topic":"...","body":"..."}     add a workspace topic',
  '  {"op":"topic-invalidate","topic":"...","reason":"..."}',
  'Rules: never invent facts that are not implied by the input; never store secrets;',
  'prefer invalidate over delete; keep values short; keys are lowercase-hyphenated.',
  'Return ONLY the JSON object, e.g. {"ops":[...]}. An empty op list is a valid answer.',
].join('\n');

/** Build the one-shot model request for a consolidation review (pure). */
export function buildConsolidationRequest(input: ModelProposalInput): {
  system: string;
  user: string;
} {
  const payload = {
    now: input.now,
    profile: input.entries.map((e) => ({
      key: e.key,
      value: e.value,
      updatedAt: e.updatedAt,
      ...(e.invalidatedAt === '' ? {} : { invalidatedAt: e.invalidatedAt }),
    })),
    workspaceTopics: input.topics.map((t) => ({
      topic: t.topic,
      body: t.body,
      updatedAt: t.updatedAt,
      ...(t.invalidatedAt === '' ? {} : { invalidatedAt: t.invalidatedAt }),
    })),
  };
  return {
    system: MODEL_SYSTEM_PROMPT,
    user: `Current memory (JSON):\n${JSON.stringify(payload, null, 2)}\n\nReturn the ops JSON object.`,
  };
}

const OP_NAMES = new Set([
  'add',
  'rewrite',
  'invalidate',
  'merge',
  'topic-add',
  'topic-invalidate',
]);

function asOp(raw: unknown): ConsolidationOp | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const op = typeof r.op === 'string' ? r.op : '';
  if (!OP_NAMES.has(op)) return null;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  switch (op) {
    case 'add':
    case 'rewrite': {
      const key = str(r.key);
      const value = typeof r.value === 'string' ? r.value : '';
      if (key === '' || value === '') return null;
      const reason = str(r.reason);
      return op === 'add'
        ? { op: 'add', key, value }
        : { op: 'rewrite', key, value, ...(reason === '' ? {} : { reason }) };
    }
    case 'invalidate': {
      const key = str(r.key);
      if (key === '') return null;
      return { op: 'invalidate', key, reason: str(r.reason) };
    }
    case 'merge': {
      const key = str(r.key);
      const into = str(r.into);
      if (key === '' || into === '' || key === into) return null;
      const reason = str(r.reason);
      return { op: 'merge', key, into, ...(reason === '' ? {} : { reason }) };
    }
    case 'topic-add': {
      const topic = str(r.topic);
      const body = typeof r.body === 'string' ? r.body : '';
      if (topic === '' || body === '') return null;
      return { op: 'topic-add', topic, body };
    }
    default: {
      const topic = str(r.topic);
      if (topic === '') return null;
      return { op: 'topic-invalidate', topic, reason: str(r.reason) };
    }
  }
}

/**
 * Parse a model answer into validated ops. Tolerates code fences and prose
 * around the JSON object; invalid ops are dropped, never applied.
 */
export function parseConsolidationOps(text: string): {
  ops: ConsolidationOp[];
  dropped: number;
  error?: string;
} {
  const start = text.indexOf('{');
  if (start < 0) return { ops: [], dropped: 0, error: 'no JSON object in the model answer' };
  // A truncated answer (opening brace, no closing one) still goes through
  // JSON.parse so the reported reason is "unexpected end of input", not a
  // misleading "no JSON object".
  const end = text.lastIndexOf('}');
  const candidate = end > start ? text.slice(start, end + 1) : text.slice(start);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return { ops: [], dropped: 0, error: `invalid JSON: ${(error as Error).message}` };
  }
  const rawOps = (parsed as { ops?: unknown }).ops;
  if (!Array.isArray(rawOps)) return { ops: [], dropped: 0, error: 'missing "ops" array' };
  const ops: ConsolidationOp[] = [];
  let dropped = 0;
  for (const raw of rawOps) {
    const op = asOp(raw);
    if (op === null) dropped += 1;
    else ops.push(op);
  }
  return { ops, dropped };
}

/** Ask the configured model for ops; degrades to `{ ops: [], error }`. */
export async function proposeOpsWithModel(
  llm: LlmLike,
  config: { provider: string; model: string; maxTokens?: number; signal?: AbortSignal },
  input: ModelProposalInput,
): Promise<{ ops: ConsolidationOp[]; dropped: number; error?: string }> {
  const request = buildConsolidationRequest(input);
  let text = '';
  try {
    for await (const chunk of llm.stream({
      provider: config.provider,
      model: config.model,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
      maxTokens: config.maxTokens ?? 1024,
      temperature: 0,
      ...(config.signal === undefined ? {} : { signal: config.signal }),
    })) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
    }
  } catch (error) {
    return { ops: [], dropped: 0, error: `model call failed: ${(error as Error).message}` };
  }
  return parseConsolidationOps(text);
}

/** One consolidation request, however it was triggered. */
export interface ConsolidateRequest {
  source: ConsolidationRecord['source'];
  /** plan = report only; apply = write and log. */
  mode: 'plan' | 'apply';
  /** Also ask the configured consolidation model for ops. */
  useModel: boolean;
  /** Workspace memory to cover, when the caller has a session workspace. */
  workspace: WorkspaceMemory | null;
  workspacePath?: string;
}

export interface ConsolidateOutcome {
  plan: ConsolidationPlan;
  record: ConsolidationRecord;
  /** Why the model-assisted layer contributed nothing, when it did not. */
  modelError?: string;
  mode?: 'plan' | 'apply';
}

/** Implemented by the plugin's composition root; injected into the tools. */
export type ConsolidateRunner = (request: ConsolidateRequest) => Promise<ConsolidateOutcome>;

/** Model-facing summary of one consolidation outcome. */
export function renderConsolidationOutcome(outcome: ConsolidateOutcome): string {
  const { plan, record } = outcome;
  const performed = outcome.mode === 'apply' || record.applied.length > 0 || record.skipped.length > 0;
  const head =
    performed
      ? `memory consolidation: ${record.applied.length} op(s) applied, ${record.skipped.length} skipped`
      : `${plan.ops.length} op(s) proposed (plan only — pass mode=apply to perform them)`;
  const lines = [head];
  if (performed) {
    for (const op of record.applied) {
      const reason = 'reason' in op && op.reason !== undefined && op.reason !== '' ? ` — ${op.reason}` : '';
      lines.push(`  • ${describeOp(op)}${reason}`);
    }
  } else {
    for (const op of plan.ops) {
      const reason = 'reason' in op && op.reason !== undefined && op.reason !== '' ? ` — ${op.reason}` : '';
      lines.push(`  • ${describeOp(op)}${reason}`);
    }
  }
  for (const item of record.skipped) lines.push(`  ✗ ${item.op} — ${item.reason}`);
  for (const note of record.notes) lines.push(`note: ${note}`);
  if (outcome.modelError !== undefined) lines.push(`model: ${outcome.modelError}`);
  if (plan.ops.length === 0 && record.skipped.length === 0) lines.push('  (nothing to consolidate)');
  return lines.join('\n');
}
