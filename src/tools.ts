/**
 * Bounded project-note tools, resolved from the executing session cwd.
 * Global preferences require opt-in sharing; missing cwd never falls back.
 * Direct edits, migration and consolidation are legacy compatibility only.
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
import type { MemoryActivity } from './activity.ts';
import { DEFAULT_POLICY, type MemoryPolicyStore } from './policy.ts';
import {
  createWorkspaceMemory,
  searchTopics,
  type TopicMode,
  type WorkspaceMemory,
  type WorkspaceMode,
} from './workspace.ts';

export interface MemoryToolsOptions {
  policy?: MemoryPolicyStore;
  legacyTools?: boolean;
  activity?: MemoryActivity;
  /** Import rejects overflow instead of evicting existing memories. */
  maxBytes?: number;
  staleAfterDays?: number;
  /** Base directory override for workspace memory (mainly for testing). */
  workspaceBase?: string;
  workspaceMode?: WorkspaceMode;
  projectPath?: string;
  /** Legacy manual consolidation, supplied by the composition root. */
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
  '当前会话没有可用的项目目录；请在项目会话中使用便签，不会自动回退到共享偏好。';

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
  const usage = () => options.policy?.read() ?? DEFAULT_POLICY;
  const blocked = () => usage().mode === 'paused';
  const globalAllowed = () => usage().mode === 'shared';
  if (options.legacyTools) registerMigrationTools(ctx, { profilePath, workspaceBase, maxBytes: options.maxBytes, workspaceMode: options.workspaceMode, allowed: globalAllowed });

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
    description: 'Propose a short project note ONLY when the user asks to save or correct durable information. Never infer a background obligation to remember conversations. The user must review it in 管理记忆 → 待确认; this tool cannot activate notes. Prefer workspace. global requires explicitly enabled shared preferences. Never save credentials or temporary requests. Source matching verifies quoted text, not its correctness.',
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
        if (blocked()) return { ok: false, error: '便签已暂停，模型不能读取或提出候选；可在管理页恢复。' };
        if (args.scope === 'global' && !globalAllowed()) return { ok: false, error: '共享偏好未开启，请保存到当前项目；跨项目偏好须由用户在管理页明确开启。' };
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
      description: 'List saved notes for THIS session project when the user asks about earlier decisions or saved notes. Do not read on every turn. Returns titles and summaries; use memory_topic for full text. Current files and current user requests take precedence. Global preferences require explicit scope=global and user-enabled sharing.',
      parameters: {
        scope: { type: 'string', enum: ['workspace', 'global'], description: 'workspace is the default; global requires enabled shared preferences' },
        query: { type: 'string', description: 'Optional keyword; filters entries by key or value' },
        limit: { type: 'number', description: 'Project summaries: default 10, max 20. Explicit global scope: default 50, max 100.' },
        includeStale: {
          type: 'boolean',
          description:
            'Compatibility only. Normal mode never returns invalidated notes, even if true.',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: isOk(value) ? fieldOf(value, 'rendered') : `便签读取失败：${fieldOf(value, 'error')}` }],
      },
      async execute(args: {
        scope?: 'workspace' | 'global';
        query?: string;
        limit?: number;
        includeStale?: boolean;
      }, exec: { agent?: { session?: { id?: string; header?: { cwd?: string } } } }): Promise<Record<string, JsonValue>> {
        if (blocked()) return { ok: false, error: '便签已暂停。' };
        const target = args.scope ?? (options.legacyTools ? 'global' : 'workspace');
        if (target === 'workspace') {
          const ws = await workspaceFor(exec, workspaceBase, options);
          if (!ws) return { ok: false, error: NO_WORKSPACE_ERROR };
          const query = (args.query ?? '').trim().toLowerCase();
          const topics = (await ws.list()).filter(t => !t.invalidatedAt && (!query || (t.topic + '\n' + t.body).toLowerCase().includes(query)));
          const slice = topics.slice(0, Math.max(0, Math.min(args.limit ?? 10, 20)));
          return { ok: true, scope: 'workspace', total: topics.length, rendered: slice.map(t => `## ${t.topic}\n${t.body.split(/\r?\n/).find(l => l.trim())?.slice(0, 240) ?? ''}`).join('\n\n') || '(no saved project notes)' };
        }
        if (!globalAllowed()) return { ok: false, error: '共享偏好未开启。' };
        const entries = await store.list();
        const query = (args.query ?? '').trim().toLowerCase();
        const matches = (entry: { key: string; value: string }): boolean =>
          query === '' ||
          entry.key.toLowerCase().includes(query) ||
          entry.value.toLowerCase().includes(query);
        const valid = entries.filter((entry) => !entry.invalidatedAt && matches(entry));
        const invalidated = entries.filter((entry) => entry.invalidatedAt && matches(entry));
        const combined = (options.legacyTools && args.includeStale ? [...valid, ...invalidated] : valid).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
        const limit = Math.max(0, Math.min(args.limit ?? 50, 100));
        const slice = combined.slice(0, limit);
        const opts: RenderOptions = { now: new Date().toISOString(), staleAfterDays };
        const body = renderEntries(slice, opts);
        for (const entry of slice) options.activity?.read(exec.agent?.session?.id, 'global', entry.key, renderEntries([entry], opts));
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

  if (options.legacyTools) ctx.tools.register(
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
        exec: { agent?: { session?: { id?: string; header?: { cwd?: string } } } },
      ): Promise<Record<string, JsonValue>> {
        const mode = args.mode ?? 'set';
        if (blocked()) return { ok: false, error: '便签已暂停。' };
        if (args.scope !== 'workspace' && !globalAllowed()) return { ok: false, error: '共享偏好未开启。' };
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
        'Search saved notes for this exact session project when earlier decisions are relevant.',
        'Shared preferences participate only when the user enabled them. Do not search routinely.',
        'Use memory_topic to read a workspace topic in full.',
      ].join('\n'),
      parameters: {
        query: { type: 'string', description: 'Keyword(s) to search for; empty = list recent memory topics' },
        limit: { type: 'number', description: 'Max results (default 10, max 20)' },
        includeStale: {
          type: 'boolean',
          description: 'Compatibility only. Normal mode always hides invalidated notes.',
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
        if (blocked()) return { ok: false, error: '便签已暂停。' };
        const query = (args.query ?? '').trim();
        const limit = Math.max(0, Math.min(args.limit ?? 10, 20));
        const includeStale = options.legacyTools === true && args.includeStale === true;
        const entries = globalAllowed() ? await store.list() : [];
        const globalTopics = entries.map((entry) => ({
          topic: entry.key,
          body: entry.value,
          updatedAt: entry.updatedAt,
          invalidatedAt: entry.invalidatedAt,
          invalidReason: entry.invalidReason,
        }));
        const ws = await workspaceFor(exec, workspaceBase, options);
        const wsTopics = ws === null ? [] : await ws.list();
        if (!ws && !globalAllowed()) return { ok: false, error: NO_WORKSPACE_ERROR };
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
        exec: { agent?: { session?: { id?: string; header?: { cwd?: string } } } },
      ): Promise<Record<string, JsonValue>> {
        if (blocked()) return { ok: false, error: '便签已暂停。' };
        const ws = await workspaceFor(exec, workspaceBase, options);
        if (ws === null) return { ok: false, topic: args.topic, error: NO_WORKSPACE_ERROR };
        const topic = await ws.read(args.topic);
        if (topic === undefined) {
          return { ok: false, topic: args.topic, error: `topic '${args.topic}' not found in this workspace` };
        }
        if (topic.invalidatedAt && !options.legacyTools) return { ok: false, topic: topic.topic, error: '这条便签已停用，请由用户在管理页核对。' };
        options.activity?.read(exec.agent?.session?.id, 'workspace', topic.topic, topic.body);
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

  if (options.legacyTools) ctx.tools.register(
    defineTool({
      name: 'memory_consolidate',
      description: [
        'Review and tidy the recorded user memory: merge duplicate entries, anchor',
        'relative dates to a real date, and retire facts that stopped being true.',
        'mode=plan (default) only reports what would change; mode=apply performs it',
        'and appends an auditable record to the consolidation log.',
        'Compatibility only. Automatic consolidation is retired.',
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
        if (!globalAllowed()) return { ok: false, error: '整理兼容工具要求用户明确开启共享偏好，暂停时不可用。' };
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
