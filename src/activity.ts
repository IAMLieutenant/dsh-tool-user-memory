/** Request receipts contain memory slices, never entire conversations or reasoning. */
import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { atomicMemoryWrite, readMemoryDocument } from './history.ts';
import { withDocumentLock } from './lock.ts';
import { projectDirectory, type WorkspaceMode } from './workspace.ts';

export interface MemorySlice {
  key: string;
  scope: 'global' | 'workspace';
  status: 'provided' | 'truncated' | 'index' | 'budget' | 'invalidated' | 'disabled' | 'overridden';
}
export interface PromptSnapshot { text: string; globalText: string; workspaceText: string; items: MemorySlice[] }
export interface MemoryReceipt {
  id: string; sessionId: string; turn: number; step: number; createdAt: string;
  promptText: string; promptTruncated?: boolean; items: MemorySlice[];
  reads: { scope: 'global' | 'workspace'; key: string; text: string }[];
}
export interface SourceMessage { seq: number; turn: number; role: 'user' | 'assistant'; text: string; truncated: boolean; cwd: string }
interface LiveSession { turn: number; step: number; active: boolean; cwd: string; messages: SourceMessage[] }
function plain(content: unknown): string {
  return typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n') : '';
}
export function createMemoryActivity(profilePath: string, recordingEnabled: () => boolean = () => true) {
  const file = `${profilePath}.receipts.json`;
  const sessions = new Map<string, LiveSession>(), staged = new Map<string, PromptSnapshot>();
  let pending = Promise.resolve();
  let writeError = '';
  async function list(): Promise<MemoryReceipt[]> {
    const doc = await readMemoryDocument(file);
    if (!doc) return [];
    if (Buffer.byteLength(doc) > 2 * 1024 * 1024) throw new Error('本轮记忆记录超过容量');
    const data = JSON.parse(doc);
    if (data.version !== 1 || !Array.isArray(data.receipts) || data.receipts.length > 50) throw new Error('本轮记忆记录格式无效');
    return data.receipts;
  }
  function enqueue(job: () => Promise<void>) {
    pending = pending.then(job).catch(() => { writeError = '部分记录未能保存，请检查记忆目录的权限或可用空间。'; });
  }
  async function mutate(change: (items: MemoryReceipt[]) => MemoryReceipt[]) {
    await withDocumentLock(`${file}.lock`, async () => {
      let items = change(await list()).slice(-50);
      let doc = JSON.stringify({ version: 1, receipts: items });
      while (Buffer.byteLength(doc) > 2 * 1024 * 1024 && items.length) {
        items = items.slice(1); doc = JSON.stringify({ version: 1, receipts: items });
      }
      await atomicMemoryWrite(file, doc + '\n');
    });
  }
  return {
    file,
    stage(sessionId: string, snapshot: PromptSnapshot) {
      staged.set(sessionId, structuredClone(snapshot));
      if (staged.size > 100) staged.delete(staged.keys().next().value!);
    },
    observe(session: { id: string; header: { cwd?: string } }, event: { type: string; seq: number; data: unknown }) {
      let live = sessions.get(session.id);
      if (!live) {
        live = { turn: 0, step: 0, active: false, cwd: session.header.cwd ?? '', messages: [] };
        sessions.set(session.id, live);
        if (sessions.size > 100) { const oldest = sessions.keys().next().value!; sessions.delete(oldest); staged.delete(oldest); }
      }
      const d = event.data as { turn?: number; step?: number; cwd?: string; source?: { kind?: string }; content?: unknown; message?: { content?: unknown } };
      if (event.type === 'working-directory/change' && typeof d.cwd === 'string') live.cwd = d.cwd;
      if (event.type === 'turn/start') {
        live.turn = d.turn!; live.step = 0; live.active = true;
        for (const message of live.messages) if (message.turn === -1) message.turn = live.turn;
      }
      if (event.type === 'step/start') { live.turn = d.turn!; live.step = d.step!; }
      if (event.type === 'turn/end') live.active = false;
      const role = event.type === 'user/message' && d.source?.kind === 'user' ? 'user' : event.type === 'assistant/message' ? 'assistant' : null;
      if (role) {
        const text = plain(role === 'user' ? d.content : d.message?.content);
        if (text.trim()) live.messages.push({ seq: event.seq, turn: d.turn ?? (live.active ? live.turn : -1), role, text: text.slice(0, 12000), truncated: text.length > 12000, cwd: live.cwd });
        live.messages = live.messages.slice(-20);
      }
    },
    capture(request: { sessionId?: string; messages: readonly { role: string; content: unknown }[] }) {
      if (!recordingEnabled()) return;
      const id = request.sessionId, live = id ? sessions.get(id) : undefined, snapshot = id ? staged.get(id) : undefined;
      if (!id || !live || !live.active || !snapshot) return;
      // The final effective system message must contain this exact staged slice.
      // A complete/scoped prompt override cannot be reported as memory delivery.
      const system = plain(request.messages.findLast(m => m.role === 'system')?.content);
      const included = snapshot.text.trim() !== '' && system.includes(snapshot.text.trim());
      const receipt: MemoryReceipt = { id: randomUUID(), sessionId: id, turn: live.turn, step: live.step,
        createdAt: new Date().toISOString(), promptText: included ? snapshot.text.slice(0, 64000) : '',
        ...(included && snapshot.text.length > 64000 ? { promptTruncated: true } : {}),
        items: snapshot.items.map(item => !included && ['provided', 'truncated', 'index'].includes(item.status) ? { ...item, status: 'overridden' } : item), reads: [] };
      enqueue(() => mutate(items => [...items, receipt]));
    },
    read(sessionId: string | undefined, scope: 'global' | 'workspace', key: string, text: string) {
      if (!recordingEnabled()) return;
      if (!sessionId) return;
      const live = sessions.get(sessionId); if (!live?.active) return;
      const { turn, step } = live;
      enqueue(() => mutate(items => {
        const receipt = items.findLast(r => r.sessionId === sessionId && r.turn === turn && r.step === step);
        if (receipt && receipt.reads.length < 20) receipt.reads.push({ scope, key, text: text.slice(0, 12000) });
        return items;
      }));
    },
    async receipts(sessionId?: string, turn?: number) {
      await pending;
      return { records: (await list()).filter(r => (!sessionId || r.sessionId === sessionId) && (turn === undefined || r.turn === turn)).reverse(), warning: writeError };
    },
    flush() { return pending; },
    async clear() {
      const clearing = pending.then(() => mutate(() => []));
      pending = clearing.catch(() => { writeError = '记录清空失败，请检查存储目录。'; });
      await clearing; writeError = '';
    },
    messages(sessionId: string, turn: number) { return structuredClone(sessions.get(sessionId)?.messages.filter(m => m.turn === turn) ?? []); },
    source(sessionId: string, seq: number, excerpt: string) {
      const session = sessions.get(sessionId), message = session?.messages.find(m => m.seq === seq);
      if (!session || !message || !excerpt.trim() || !message.text.includes(excerpt)) throw new Error('原话不在当前可核验的消息中，请重新打开这轮消息。');
      return { message: structuredClone(message), cwd: message.cwd };
    },
  };
}
export type MemoryActivity = ReturnType<typeof createMemoryActivity>;
export function installMemoryActivity(ctx: Context, activity: MemoryActivity): void {
  ctx.effect(() => () => activity.flush());
  const loopSignals = new WeakMap<AbortSignal, string>();
  ctx.on('session/event', (session, event) => activity.observe(session, event));
  ctx.on('agent/request', (payload, next) => {
    loopSignals.set(payload.signal, payload.agent.session.id);
    return next();
  });
  // Optional LLM service: manager-only profiles remain usable without a model runtime.
  ctx.inject(['llm'], child => {
    child.on('llm/stream', async function* (request, next) {
      try { if (request.signal && loopSignals.get(request.signal) === request.sessionId) activity.capture(request); } catch { /* Recording never breaks a model request. */ }
      yield* next();
    });
  });
}
export function sourceWorkspace(cwd: string, mode: WorkspaceMode | undefined, override = ''): string | undefined {
  return cwd || override ? projectDirectory(cwd || override, mode, override) : undefined;
}
