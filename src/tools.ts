/**
 * Model-facing tools:
 *   - `memory_get`    — read the user profile (global personal memory)
 *   - `memory_update` — record a stable preference (global, or workspace-scoped)
 *   - `memory_search` — keyword search across global + current workspace memory
 *   - `memory_topic`  — read one workspace memory topic in full
 *
 * Workspace-scoped calls resolve the session's workspace from the tool
 * execution's `agent` (set by the agent loop): `agent.session.header.cwd`.
 * Executions without an agent (diagnostics, tests) can only address the
 * global profile.
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { renderEntries, type MergeMode, type RenderOptions } from './profile.ts';
import {
  renderConsolidationOutcome,
  type ConsolidateRunner,
} from './consolidate.ts';
import type { MemoryStore } from './store.ts';
import { registerMigrationTools } from './migration-tools.ts';
import { createCandidateStore } from './candidates.ts';
import {
  createWorkspaceMemory,
  searchTopics,
  type TopicMode,
  type WorkspaceMemory,
  type WorkspaceMode,
} from './workspace.ts';

export interface MemoryToolsOptions {
  /** Import rejects overflow instead of evicting existing memories. */
  maxBytes?: number;
  staleAfterDays?: number;
  /** Base directory override for workspace memory (mainly for testing). */
  workspaceBase?: string;
  workspaceMode?: WorkspaceMode;
  projectPath?: string;
  /** Background-consolidation entry point, supplied by the composition root. */
  consolidate?: ConsolidateRunner;
}

/** Read a field off a JSON-schema-typed render value defensively. */
function fieldOf(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const record = value as Record<string, unknown>;
  const field = record[key];
  return field === undefined ? '' : String(field);
}

function isOk(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).ok === true;
}

function evictedOf(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const evicted = (value as Record<string, unknown>).evicted;
  return Array.isArray(evicted) ? evicted.map((item) => String(item)) : [];
}

const NO_WORKSPACE_ERROR =
  'no workspace detected for this session (the session has no cwd, or it is inaccessible); use scope=global for personal memory';

/** Resolve the executing session's workspace memory, or null when none. */
async function workspaceFor(exec: { agent?: { session?: { header?: { cwd?: string } } } }, baseDir: string, options: MemoryToolsOptions): Promise<WorkspaceMemory | null> {
  const cwd = options.projectPath || exec.agent?.session?.header?.cwd;
  if (typeof cwd !== 'string' || cwd.trim() === '') return null;
  try {
    return await createWorkspaceMemory({ cwd, baseDir, mode: options.workspaceMode, projectPath: options.projectPath });
  } catch {
    // A cwd that vanished (ENOENT) means no usable workspace.
    return null;
  }
}

function renderSearchResults(value: unknown): { type: 'text'; text: string } {
  if (!isOk(value)) {
    return { type: 'text', text: `memory search failed: ${fieldOf(value, 'error') || 'unknown error'}` };
  }
  const results = (value as Record<string, unknown>).results;
  if (!Array.isArray(results) || results.length === 0) {
    return { type: 'text', text: '(no memory matches)' };
  }
  const lines = results.map((hit, i) => {
    const h = hit as { scope?: string; topic?: string; score?: number; snippet?: string };
    return `${i + 1}. [${h.scope ?? 'global'}] ${h.topic ?? '?'} (score ${h.score ?? 0}) — ${h.snippet ?? ''}`;
  });
  return { type: 'text', text: lines.join('\n') };
}

export function registerMemoryTools(ctx: Context, store: MemoryStore, options: MemoryToolsOptions = {}): void {
  const staleAfterDays = options.staleAfterDays ?? 0;
  const workspaceBase = options.workspaceBase ?? '';
  const consolidate = options.consolidate;
  const profilePath = store.path();
  registerMigrationTools(ctx, { profilePath, workspaceBase, maxBytes: options.maxBytes, workspaceMode: options.workspaceMode });

  const candidates = createCandidateStore(profilePath);
  // Capture only live, direct human messages. Do not scan private session logs
  // or accept a model-supplied session ID as proof of a source.
  const recent = new WeakMap<object, { seq: number; text: string }[]>();
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'user/message') return;
    const data = event.data as unknown as { source?: { kind?: string }; content?: unknown };
    if (data.source?.kind !== 'user') return;
    const content = data.content;
    const text = typeof content === 'string' ? content : Array.isArray(content)
      ? content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n') : '';
    if (!text) return;
    recent.set(session, [...(recent.get(session) ?? []), { seq: event.seq, text: text.slice(0, 20000) }].slice(-10));
  });
  ctx.tools.register(defineTool({
    name: 'memory_propose',
    description: 'Propose a durable memory or correction for human review in 管理记忆 → 待确认. Use for inferred facts, corrections, or when the user wants to review before saving. It is NOT saved as active memory and is NOT injected until the human confirms in the manager. Choose workspace for project facts, global only for cross-project preferences. Do not propose temporary requests. Source excerpts are checked against recently observed direct user messages by the host; a text match does not prove that your interpretation is correct. This tool cannot accept candidates.',
    parameters: {
      key: { type: 'string', required: true, description: 'Stable memory name; use the existing name for a correction so the manager can show the previous value.' },
      value: { type: 'string', required: true, description: 'Proposed durable content, at most 12000 characters.' },
      scope: { type: 'string', required: true, enum: ['global', 'workspace'], description: 'Required explicit scope. workspace requires the executing session to have a working directory.' },
      excerpt: { type: 'string', description: 'Optional reference excerpt (unverified, at most 2000 characters).' },
      reason: { type: 'string', description: 'Why this is worth remembering, at most 500 characters.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args: { key: string; value: string; scope: 'global' | 'workspace'; excerpt?: string; reason?: string }, exec: { agent?: { session?: { id?: string; header?: { id?: string; cwd?: string } } } }): Promise<Record<string, JsonValue>> {
      try {
        const ws = args.scope === 'workspace' ? await workspaceFor(exec, workspaceBase, options) : null;
        if (args.scope === 'workspace' && !ws) return { ok: false, error: NO_WORKSPACE_ERROR };
        const sid = exec.agent?.session?.id ?? exec.agent?.session?.header?.id;
        const excerpt = args.excerpt ?? '';
        const source = excerpt && exec.agent?.session ? recent.get(exec.agent.session)?.findLast(e => e.text.includes(excerpt)) : undefined;
        const item = await candidates.propose({ key: args.key.trim(), value: args.value, scope: args.scope,
          ...(ws ? { workspacePath: ws.path } : {}), ...(typeof sid === 'string' ? { sourceSessionId: sid } : {}),
          ...(source ? { sourceEventSeq: source.seq } : {}), excerptVerified: !!source,
          excerpt, reason: args.reason ?? '' });
        return { ok: true, candidateId: item.id, status: 'pending', active: false, message: '候选已提交，尚未生效。请在管理记忆的“待确认”中核对范围和内容后保存。' };
      } catch (error) { return { ok: false, error: (error as Error).message }; }
    },
  }));

  ctx.tools.register(
    defineTool({
      name: 'memory_get',
      description: [
        'Read the user preference memory (persisted across sessions).',
        'Call this when you need to personalise a response: preferred language,',
        'communication style, project background, or any previously recorded preference.',
        'Invalidated (superseded) entries are hidden by default; pass includeStale=true to audit them.',
        `Profile file: ${profilePath}`,
      ].join('\n'),
      parameters: {
        query: { type: 'string', description: 'Optional keyword; filters entries by key or value' },
        limit: { type: 'number', description: 'Max entries to return (default 50, max 100)' },
        includeStale: {
          type: 'boolean',
          description:
            'Also return invalidated entries (clearly marked); default false. Use for auditing what was superseded.',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: fieldOf(value, 'rendered') }],
      },
      async execute(args: {
        query?: string;
        limit?: number;
        includeStale?: boolean;
      }): Promise<Record<string, JsonValue>> {
        const entries = await store.list();
        const query = (args.query ?? '').trim().toLowerCase();
        const matches = (entry: { key: string; value: string }): boolean =>
          query === '' ||
          entry.key.toLowerCase().includes(query) ||
          entry.value.toLowerCase().includes(query);
        const valid = entries.filter((entry) => !entry.invalidatedAt && matches(entry));
        const invalidated = entries.filter((entry) => entry.invalidatedAt && matches(entry));
        const combined = (args.includeStale ? [...valid, ...invalidated] : valid).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
        const limit = Math.max(0, Math.min(args.limit ?? 50, 100));
        const slice = combined.slice(0, limit);
        const opts: RenderOptions = { now: new Date().toISOString(), staleAfterDays };
        const body = renderEntries(slice, opts);
        // Canonical value stays scalar + rendered text; the model sees `rendered`.
        return {
          ok: true,
          total: combined.length,
          invalidated: invalidated.length,
          rendered: body === '' ? '(no user memory recorded yet)' : body,
        };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'memory_update',
      description: [
        'Record a user preference into the persisted user memory.',
        'For inferred facts, corrections, or review-before-save requests, use memory_propose instead.',
        'Use this direct-write tool when the user explicitly asks to save a stable memory.',
        'Call this when the user expresses a STABLE, long-term preference, introduces',
        'themselves or their project, or states a goal ("I prefer short answers",',
        '"I work on RAG retrieval", "my goal is to contribute to the harness").',
        'Do NOT store one-off requests, and NEVER store credentials, passwords or tokens.',
        'When a recorded preference is SUPERSEDED (project/role/goal changed), prefer',
        'mode=invalidate over remove: the old entry stays in the file for audit (marked',
        'with date + reason) but is hidden from the prompt and from memory_get.',
        'Calling set or append on an invalidated key revives it.',
        'scope=workspace stores project-level notes (conventions, architecture, build',
        'commands) that belong to THIS directory instead of the personal profile.',
        `Profile file: ${profilePath}`,
      ].join('\n'),
      parameters: {
        key: {
          type: 'string',
          required: true,
          description:
            'Preference key (or workspace topic name), e.g. language, communication-style, build-conventions',
        },
        value: {
          type: 'string',
          required: true,
          description: 'Preference content (pass "" for mode=invalidate and mode=remove)',
        },
        mode: {
          type: 'string',
          enum: ['set', 'append', 'remove', 'invalidate'],
          description:
            'set (default) replaces and revives, append adds a line, remove deletes the key, invalidate soft-deletes it (keeps history, hides it from the prompt)',
        },
        reason: {
          type: 'string',
          description:
            'For mode=invalidate: why the memory is no longer correct (e.g. "superseded by project-agent-platform"). Stored with the entry for audit.',
        },
        scope: {
          type: 'string',
          enum: ['global', 'workspace'],
          description:
            'global (default) = personal profile shared by all sessions; workspace = this session\'s project memory (topic files, visible to every session opened in the same directory)',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          if (!isOk(value)) {
            return [{ type: 'text', text: `memory update failed: ${fieldOf(value, 'error') || 'unknown error'}` }];
          }
          const evicted = evictedOf(value);
          const mode = fieldOf(value, 'mode');
          const scope = fieldOf(value, 'scope') === 'workspace' ? ' (workspace)' : '';
          const text =
            mode === 'invalidate'
              ? `memory invalidated (${fieldOf(value, 'key')})${scope} — kept in file for audit, hidden from the prompt`
              : `memory updated (${fieldOf(value, 'key')})${scope}` +
                (evicted.length > 0
                  ? `; archived older entries to stay within limit: ${evicted.join(', ')}`
                  : '');
          return [{ type: 'text', text }];
        },
      },
      async execute(
        args: {
          key: string;
          value: string;
          mode?: MergeMode;
          reason?: string;
          scope?: 'global' | 'workspace';
        },
        exec: { agent?: { session?: { header?: { cwd?: string } } } },
      ): Promise<Record<string, JsonValue>> {
        const mode = args.mode ?? 'set';
        if (args.scope === 'workspace') {
          const ws = await workspaceFor(exec, workspaceBase, options);
          if (ws === null) {
            return { ok: false, scope: 'workspace', key: args.key, mode, bytes: 0, error: NO_WORKSPACE_ERROR };
          }
          const result = await ws.write(args.key, args.value, mode as TopicMode, args.reason ?? '');
          return result.ok
            ? { ok: true, scope: 'workspace', key: result.topic, mode: result.mode, bytes: 0 }
            : { ok: false, scope: 'workspace', key: result.topic, mode: result.mode, bytes: 0, error: result.error ?? '' };
        }
        const result = await store.update(args.key, args.value, mode, args.reason ?? '');
        return result.ok
          ? {
              ok: true,
              scope: 'global',
              key: result.key,
              mode: result.mode,
              bytes: result.bytes,
              evicted: result.evicted,
              truncated: result.truncated,
              archivePath: result.archivePath ?? null,
            }
          : {
              ok: false,
              scope: 'global',
              key: result.key,
              mode: result.mode,
              bytes: 0,
              evicted: [],
              truncated: null,
              error: result.error ?? '',
            };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'memory_search',
      description: [
        'Search user memory by keyword: the global personal profile plus this',
        'session\'s workspace memory. Returns ranked hits with one-line snippets.',
        'Use memory_topic to read a workspace topic in full.',
      ].join('\n'),
      parameters: {
        query: { type: 'string', description: 'Keyword(s) to search for; empty = list recent memory topics' },
        limit: { type: 'number', description: 'Max results (default 10, max 20)' },
        includeStale: {
          type: 'boolean',
          description: 'Also search invalidated entries (marked); default false',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [renderSearchResults(value)],
      },
      async execute(
        args: { query?: string; limit?: number; includeStale?: boolean },
        exec: { agent?: { session?: { header?: { cwd?: string } } } },
      ): Promise<Record<string, JsonValue>> {
        const query = (args.query ?? '').trim();
        const limit = Math.max(0, Math.min(args.limit ?? 10, 20));
        const includeStale = args.includeStale === true;
        const entries = await store.list();
        const globalTopics = entries.map((entry) => ({
          topic: entry.key,
          body: entry.value,
          updatedAt: entry.updatedAt,
          invalidatedAt: entry.invalidatedAt,
          invalidReason: entry.invalidReason,
        }));
        const ws = await workspaceFor(exec, workspaceBase, options);
        const wsTopics = ws === null ? [] : await ws.list();
        const gHits = searchTopics(globalTopics, query, includeStale).map((h) => ({ ...h, scope: 'global' }));
        const wHits = searchTopics(wsTopics, query, includeStale).map((h) => ({ ...h, scope: 'workspace' }));
        const merged = [...gHits, ...wHits].sort(
          (a, b) => b.score - a.score || (a.updatedAt < b.updatedAt ? 1 : -1),
        );
        const results: Record<string, JsonValue>[] = merged.slice(0, limit).map((hit) => ({
          scope: hit.scope,
          topic: hit.topic,
          score: hit.score,
          updatedAt: hit.updatedAt,
          snippet: hit.snippet,
        }));
        return { ok: true, total: results.length, results };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'memory_topic',
      description: [
        'Read one workspace memory topic in full. Topic names appear in the',
        'injected workspace memory index (when this session\'s workspace has',
        'memory) and in memory_search results.',
      ].join('\n'),
      parameters: {
        topic: {
          type: 'string',
          required: true,
          description: 'Topic name (workspace-scoped)',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          if (!isOk(value)) {
            return [{ type: 'text', text: `memory_topic failed: ${fieldOf(value, 'error') || 'unknown error'}` }];
          }
          const invalidated = fieldOf(value, 'invalidated');
          const reason = fieldOf(value, 'invalidReason');
          const marker =
            invalidated !== ''
              ? `[invalidated ${invalidated.slice(0, 10)}${reason !== '' ? `: ${reason}` : ''}]\n`
              : '';
          return [{ type: 'text', text: `${marker}${fieldOf(value, 'body')}` }];
        },
      },
      async execute(
        args: { topic: string },
        exec: { agent?: { session?: { header?: { cwd?: string } } } },
      ): Promise<Record<string, JsonValue>> {
        const ws = await workspaceFor(exec, workspaceBase, options);
        if (ws === null) return { ok: false, topic: args.topic, error: NO_WORKSPACE_ERROR };
        const topic = await ws.read(args.topic);
        if (topic === undefined) {
          return { ok: false, topic: args.topic, error: `topic '${args.topic}' not found in this workspace` };
        }
        return {
          ok: true,
          topic: topic.topic,
          updatedAt: topic.updatedAt,
          invalidated: topic.invalidatedAt,
          invalidReason: topic.invalidReason,
          body: topic.body,
        };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'memory_consolidate',
      description: [
        'Review and tidy the recorded user memory: merge duplicate entries, anchor',
        'relative dates to a real date, and retire facts that stopped being true.',
        'mode=plan (default) only reports what would change; mode=apply performs it',
        'and appends an auditable record to the consolidation log.',
        'The plugin can also run this automatically in the background when',
        'autoConsolidate is enabled; call it manually after a long session, or when',
        'the memory feels stale or contradictory.',
      ].join('\n'),
      parameters: {
        mode: {
          type: 'string',
          enum: ['plan', 'apply'],
          description: 'plan (default) reports the ops; apply performs them and writes the log',
        },
        useModel: {
          type: 'boolean',
          description:
            'Also ask the configured consolidation model for ops (requires consolidateProvider/consolidateModel)',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: fieldOf(value, 'rendered') }],
      },
      async execute(
        args: { mode?: 'plan' | 'apply'; useModel?: boolean },
        exec: { agent?: { session?: { header?: { cwd?: string } } } },
      ): Promise<Record<string, JsonValue>> {
        if (consolidate === undefined) {
          return { ok: false, error: 'consolidation is not wired in this instance' };
        }
        const ws = await workspaceFor(exec, workspaceBase, options);
        const useModel = args.useModel === true;
        const outcome = await consolidate({
          source: 'manual',
          mode: args.mode === 'apply' ? 'apply' : 'plan',
          useModel,
          workspace: ws,
          ...(ws === null ? {} : { workspacePath: ws.path }),
        });
        return {
          ok: true,
          mode: args.mode === 'apply' ? 'apply' : 'plan',
          proposed: outcome.plan.ops.length,
          applied: outcome.record.applied.length,
          skipped: outcome.record.skipped.length,
          notes: outcome.plan.notes,
          modelError: outcome.modelError ?? '',
          rendered: renderConsolidationOutcome(outcome),
        };
      },
    }),
  );
}
