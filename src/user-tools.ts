/** Normal runtime: confirmed user preferences only. No project or session memory. */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { createCandidateStore } from './candidates.ts';
import { renderEntries } from './profile.ts';
import type { MemoryStore } from './store.ts';
import type { MemoryPolicyStore } from './policy.ts';
import { AUTO_KINDS, createAutomaticMemory } from './auto-memory.ts';

export function registerUserMemoryTools(ctx: Context, store: MemoryStore, policy: MemoryPolicyStore) {
  const candidates = createCandidateStore(store.path());
  const enabled = () => { const p = policy.read(); return p.mode === 'shared' && p.inject; };
  const recent = new WeakMap<object, { seq: number; text: string }[]>();
  const turns = new WeakMap<object, number>(), consumed = new WeakMap<object, Set<string>>();
  const automatic = createAutomaticMemory(store, policy);
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') turns.set(session, (event.data as { turn: number }).turn);
    if (event.type !== 'user/message') return;
    const d = event.data as { source?: { kind?: string }; content?: unknown };
    if (d.source?.kind !== 'user') return;
    const text = typeof d.content === 'string' ? d.content : Array.isArray(d.content)
      ? d.content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n') : '';
    if (text) recent.set(session, [...(recent.get(session) ?? []), { seq: event.seq, text: text.slice(0, 12000) }].slice(-10));
  });
  ctx.tools.register(defineTool({
    name: 'memory_remember',
    description: 'Automatically remember a clear, enduring FIRST-PERSON user fact naturally expressed in the latest user message; no explicit remember request is needed. Allowed: professional background, skill familiarity, language preference, communication preference. NEVER project facts, constraints, workflows, instructions, authorization, temporary requests, quotes, pasted documents, assistant guesses or secrets. Skip uncertainty. Use a verbatim personal clause as value for background/skill; language is 中文 or 英文; style is 简短, 详细, 先说结论 or 通俗易懂. The host validates the quote and allows undo. Do not repeat a saved or rejected attempt.',
    parameters: { kind: { type: 'string', required: true, enum: [...AUTO_KINDS] }, value: { type: 'string', required: true }, excerpt: { type: 'string', required: true, description: 'Exact first-person quote from the latest user message, at most 600 characters' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args: { kind: string; value: string; excerpt: string }, exec: { agent?: { session?: { id?: string } } }): Promise<Record<string, JsonValue>> {
      try {
        const session = exec.agent?.session, source = session ? recent.get(session)?.at(-1) : undefined, turn = session ? turns.get(session) : undefined;
        if (!session?.id || !source || turn === undefined) throw new Error('没有可核验的当前用户消息，已跳过。');
        const stamp = source.seq + ':' + args.kind, used = consumed.get(session) ?? new Set<string>();
        if (used.has(stamp)) return { ok: true, saved: false, message: '这条信息已处理，不重复写入。' };
        const result = await automatic.save(args.kind, args.value, args.excerpt, { ...source, sessionId: session.id, turn });
        used.add(stamp); consumed.set(session, used.size > 40 ? new Set([...used].slice(-20)) : used);
        return { ok: true, ...result };
      } catch (e) { return { ok: false, saved: false, error: (e as Error).message }; }
    },
  }));
  for (const name of ['memory_get', 'memory_search'] as const) ctx.tools.register(defineTool({
    name,
    description: 'Read saved USER preferences, communication style and durable personal background. Never project facts, task progress or conversation summaries. Current user requests take precedence. Do not call routinely when preferences are already present in the prompt.',
    parameters: { query: { type: 'string', description: 'Optional keyword; empty lists preferences' }, limit: { type: 'number', description: 'Maximum results, default 10, at most 20' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args: { query?: string; limit?: number }): Promise<Record<string, JsonValue>> {
      if (!enabled()) return { ok: false, error: '用户记忆已停用。' };
      const query = (args.query ?? '').trim().toLowerCase();
      const all = (await store.list()).filter(e => !e.invalidatedAt && (!query || (e.key + '\n' + e.value).toLowerCase().includes(query)));
      const entries = all.slice(0, Math.max(0, Math.min(args.limit ?? 10, 20)));
      return { ok: true, total: all.length, rendered: renderEntries(entries) || '(no saved user memory)' };
    },
  }));
  ctx.tools.register(defineTool({
    name: 'memory_propose',
    description: 'ONLY when the user explicitly asks to remember or correct a lasting personal preference, propose user memory for human review. Never save project technology, repository rules, task progress or conversation summaries. Never save credentials. This cannot activate or overwrite memory; the user confirms in the manager.',
    parameters: {
      key: { type: 'string', required: true, description: 'Stable name, e.g. 回答偏好; reuse the existing name when correcting it' },
      value: { type: 'string', required: true, description: 'Short user preference or durable personal background' },
      excerpt: { type: 'string', description: 'Optional direct user quote; host checks against recent user messages' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args: { key: string; value: string; excerpt?: string }, exec: { agent?: { session?: { id?: string } } }): Promise<Record<string, JsonValue>> {
      if (!enabled()) return { ok: false, error: '用户记忆已停用。' };
      try {
        const excerpt = args.excerpt ?? '', session = exec.agent?.session;
        const source = session && excerpt ? recent.get(session)?.findLast(m => m.text.includes(excerpt)) : undefined;
        const c = await candidates.propose({ key: args.key.trim(), value: args.value, scope: 'global', excerpt,
          excerptVerified: !!source, ...(session?.id ? { sourceSessionId: session.id } : {}), ...(source ? { sourceEventSeq: source.seq } : {}), reason: '' });
        return { ok: true, candidateId: c.id, active: false, message: '已提交待确认记忆，用户保存后才生效。' };
      } catch (e) { return { ok: false, error: (e as Error).message }; }
    },
  }));
}
