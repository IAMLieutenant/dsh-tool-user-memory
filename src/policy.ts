/** Small, local policy. Invalid settings fail closed without deleting any notes. */
import { readFileSync } from 'node:fs';
import { atomicMemoryWrite, documentHash } from './history.ts';
import { withDocumentLock } from './lock.ts';

export interface MemoryPolicy { mode: 'project' | 'shared' | 'paused'; inject: boolean; diagnostics: boolean }
export const DEFAULT_POLICY: MemoryPolicy = { mode: 'project', inject: false, diagnostics: false };
function validate(value: unknown): MemoryPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('使用设置格式无效');
  const v = value as Record<string, unknown>;
  if (typeof v.mode !== 'string' || !['project', 'shared', 'paused'].includes(v.mode) || typeof v.inject !== 'boolean' || typeof v.diagnostics !== 'boolean') throw new Error('使用设置格式无效');
  return { mode: v.mode as MemoryPolicy['mode'], inject: v.inject, diagnostics: v.diagnostics };
}
export function createMemoryPolicy(profile: string, defaults: Partial<MemoryPolicy> = {}, userOnly = false) {
  const file = `${profile}.policy.json`, initial = validate({ ...DEFAULT_POLICY, ...defaults });
  function snapshot() {
    let doc: string | null = null;
    try { doc = readFileSync(file, 'utf8'); if (Buffer.byteLength(doc) > 4096) throw new Error('设置文件过大'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { values: initial, revision: documentHash(null), warning: '' };
      return { values: { ...DEFAULT_POLICY, mode: 'paused' as const }, revision: documentHash(doc), warning: '使用设置无法读取，已暂停模型访问；请检查目录权限或重新保存设置。' };
    }
    try {
      const data = JSON.parse(doc);
      let values: MemoryPolicy;
      if (data.version === 2 && typeof data.enabled === 'boolean') values = { mode: data.enabled ? 'shared' : 'paused', inject: data.enabled, diagnostics: false };
      else if (data.version === 1) {
        values = validate(data);
        if (userOnly) { const enabled = values.mode === 'shared' && values.inject; values = { mode: enabled ? 'shared' : 'paused', inject: enabled, diagnostics: false }; }
      } else throw new Error('版本无效');
      return { values, revision: documentHash(doc), warning: '' };
    }
    catch { return { values: { ...DEFAULT_POLICY, mode: 'paused' as const }, revision: documentHash(doc), warning: '使用设置损坏，已暂停模型访问；请核对后重新保存设置。' }; }
  }
  return {
    file, snapshot,
    read: () => snapshot().values,
    async save(value: unknown, revision: string) {
      const values = validate(value);
      await withDocumentLock(`${file}.lock`, async () => {
        if (snapshot().revision !== revision) throw new Error('使用设置已变化，请刷新后重试');
        await atomicMemoryWrite(file, JSON.stringify(userOnly ? { version: 2, enabled: values.mode === 'shared' && values.inject } : { version: 1, ...values }, null, 2) + '\n');
      });
      return snapshot();
    },
  };
}
export type MemoryPolicyStore = ReturnType<typeof createMemoryPolicy>;
