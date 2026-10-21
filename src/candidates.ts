/** Candidates are isolated from active memory. Only the local manager can review them. */
import { randomUUID } from 'node:crypto';
import { atomicMemoryWrite, documentHash, readMemoryDocument } from './history.ts';
import { withDocumentLock } from './lock.ts';
import { validateKey, RESERVED_KEYS } from './profile.ts';
import { normalizeTopic } from './workspace.ts';

export interface MemoryCandidate {
  id: string;
  key: string;
  value: string;
  scope: 'global' | 'workspace';
  workspacePath?: string;
  sourceSessionId?: string;
  sourceEventSeq?: number;
  excerptVerified?: boolean;
  excerpt: string;
  reason: string;
  createdAt: string;
  status: 'pending' | 'accepted' | 'dismissed';
  reviewedAt?: string;
}
export type CandidateInput = Omit<MemoryCandidate, 'id' | 'status' | 'createdAt' | 'reviewedAt'>;
export function createCandidateStore(profilePath: string) {
  const file = `${profilePath}.candidates.json`;
  async function read(): Promise<MemoryCandidate[]> {
    const doc = await readMemoryDocument(file);
    if (doc === null) return [];
    if (Buffer.byteLength(doc) > 2 * 1024 * 1024) throw new Error('待确认记忆文件超过容量');
    const data = JSON.parse(doc);
    if (data.version !== 1 || !Array.isArray(data.candidates) || data.candidates.length > 300) throw new Error('待确认记忆格式无效');
    for (const c of data.candidates) {
      validate(c);
      if (typeof c.id !== 'string' || !/^[a-f0-9-]{36}$/.test(c.id) || !['pending', 'accepted', 'dismissed'].includes(c.status) || !Number.isFinite(Date.parse(c.createdAt))) throw new Error('待确认记忆格式无效');
    }
    return data.candidates;
  }
  async function write(items: MemoryCandidate[]) {
    const pending = items.filter(c => c.status === 'pending');
    const finished = items.filter(c => c.status !== 'pending').slice(-200);
    const doc = JSON.stringify({ version: 1, candidates: [...finished, ...pending] }, null, 2) + '\n';
    if (Buffer.byteLength(doc) > 2 * 1024 * 1024) throw new Error('待确认记忆文件超过容量');
    await atomicMemoryWrite(file, doc);
  }
  return {
    file,
    list: read,
    async propose(input: CandidateInput) {
      validate(input);
      return withDocumentLock(`${file}.lock`, async () => {
        const items = await read();
        const same = items.find(c => c.status === 'pending' && c.key === input.key && c.value === input.value && c.scope === input.scope && c.workspacePath === input.workspacePath && c.sourceSessionId === input.sourceSessionId);
        if (same) return same;
        if (items.filter(c => c.status === 'pending').length >= 100) throw new Error('已有 100 条待确认记忆，请先确认或忽略一部分');
        const item: MemoryCandidate = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), status: 'pending' };
        await write([...items, item]); return item;
      });
    },
    async review<T>(id: string, revision: string, status: 'accepted' | 'dismissed', apply: (candidate: MemoryCandidate) => Promise<T>): Promise<T> {
      return withDocumentLock(`${file}.lock`, async () => {
        const items = await read(), candidate = items.find(c => c.id === id);
        if (!candidate || candidate.status !== 'pending' || documentHash(JSON.stringify(candidate)) !== revision) throw new Error('候选已变化或已处理，请刷新待确认列表');
        const result = await apply(candidate);
        candidate.status = status; candidate.reviewedAt = new Date().toISOString();
        // Target writes carry candidateId. A retry after a queue-write failure can
        // recognize a completed write without overwriting subsequent content.
        await write(items); return result;
      });
    },
  };
}
function validate(c: CandidateInput): void {
  if (!c || typeof c !== 'object' || typeof c.key !== 'string' || c.key !== c.key.trim() || validateKey(c.key) || RESERVED_KEYS.has(c.key)) throw new Error('候选名称无效');
  if (!['global', 'workspace'].includes(c.scope) || (c.scope === 'workspace' && (!c.workspacePath || !normalizeTopic(c.key).ok))) throw new Error('候选项目范围无效');
  for (const [name, max] of [['value', 12000], ['excerpt', 2000], ['reason', 500], ['workspacePath', 4096], ['sourceSessionId', 256]] as const) {
    const value = c[name];
    if ((name === 'workspacePath' || name === 'sourceSessionId') && value === undefined) continue;
    if (typeof value !== 'string' || value.length > max) throw new Error('候选内容长度或格式无效');
  }
  if (!c.value.trim()) throw new Error('候选内容不能为空');
  if (c.excerptVerified !== undefined && typeof c.excerptVerified !== 'boolean') throw new Error('来源核验状态无效');
  if (c.sourceEventSeq !== undefined && (!Number.isSafeInteger(c.sourceEventSeq) || c.sourceEventSeq < 0)) throw new Error('来源消息位置无效');
}
