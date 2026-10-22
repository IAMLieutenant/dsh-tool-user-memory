/** Portable evidence. Model-supplied excerpts are never presented as verified user quotes. */
export interface MemoryProvenance {
  createdAt: string;
  confirmedAt?: string;
  method: 'manual' | 'candidate' | 'tool' | 'automatic';
  automaticId?: string;
  automaticTurn?: number;
  previousEntry?: string;
  sourceSessionId?: string;
  sourceEventSeq?: number;
  sourceRole?: 'user' | 'assistant';
  excerptVerified?: boolean;
  excerpt?: string;
  candidateId?: string;
  previousValue?: string;
}

export function parseProvenance(value: unknown): MemoryProvenance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('记忆来源格式无效');
  const v = value as Record<string, unknown>;
  if (!['manual', 'candidate', 'tool', 'automatic'].includes(String(v.method))) throw new Error('记忆来源类型无效');
  const out: MemoryProvenance = { method: v.method as MemoryProvenance['method'], createdAt: stamp(v.createdAt) };
  if (v.sourceRole !== undefined) { if (!['user', 'assistant'].includes(String(v.sourceRole))) throw new Error('来源角色无效'); out.sourceRole = v.sourceRole as 'user' | 'assistant'; }
  if (v.confirmedAt !== undefined) out.confirmedAt = stamp(v.confirmedAt);
  if (v.excerptVerified !== undefined) { if (typeof v.excerptVerified !== 'boolean') throw new Error('来源核验状态无效'); out.excerptVerified = v.excerptVerified; }
  if (v.sourceEventSeq !== undefined) { if (!Number.isSafeInteger(v.sourceEventSeq) || (v.sourceEventSeq as number) < 0) throw new Error('来源消息位置无效'); out.sourceEventSeq = v.sourceEventSeq as number; }
  if (v.automaticTurn !== undefined) { if (!Number.isSafeInteger(v.automaticTurn) || (v.automaticTurn as number) < 0) throw new Error('自动记忆轮次无效'); out.automaticTurn = v.automaticTurn as number; }
  for (const [key, max] of [['sourceSessionId', 256], ['excerpt', 2000], ['candidateId', 64], ['previousValue', 16384], ['automaticId', 64], ['previousEntry', 16384]] as const) {
    if (v[key] !== undefined) {
      if (typeof v[key] !== 'string' || v[key].length > max) throw new Error('记忆来源长度无效');
      out[key] = v[key];
    }
  }
  return out;
}
function stamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('记忆来源时间无效');
  return value;
}

export const PROVENANCE_PREFIX = '<!-- memory-origin: ';
export function originLine(value: MemoryProvenance): string {
  return `${PROVENANCE_PREFIX}${encodeURIComponent(JSON.stringify(parseProvenance(value)))} -->`;
}
export function readOrigin(line: string): MemoryProvenance {
  if (!line.endsWith(' -->')) throw new Error('记忆来源格式无效');
  return parseProvenance(JSON.parse(decodeURIComponent(line.slice(PROVENANCE_PREFIX.length, -4))));
}
