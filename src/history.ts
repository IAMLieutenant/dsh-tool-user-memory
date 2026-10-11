/** Durable pre-write snapshots. Call recordHistory while holding the document lock. */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { withDocumentLock } from './lock.ts';

export const HISTORY_LIMIT = 20;
export const DOCUMENT_LIMIT = 16 * 1024 * 1024;
export interface HistoryRecord { id: string; createdAt: string; label: string; before: string | null; afterHash: string }
export function documentHash(doc: string | null): string {
  return createHash('sha256').update(doc === null ? '\0absent' : `text:${doc}`).digest('hex');
}
function directory(file: string, kind: 'history' | 'archive'): string {
  // Including the filename allows multiple custom profiles in the same directory.
  return path.join(path.dirname(file), `.${kind}`, createHash('sha256').update(path.basename(file)).digest('hex').slice(0, 16));
}
export async function readMemoryDocument(file: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > DOCUMENT_LIMIT) throw new Error('记忆文件不是常规文件或超过 16 MiB');
    return await fs.readFile(file, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function safeDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Reject redirected metadata paths, including their parent.
  for (const item of [path.dirname(dir), dir]) {
    const st = await fs.lstat(item);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('历史或归档目录不能是符号链接');
  }
}
export async function atomicMemoryWrite(file: string, doc: string | null): Promise<void> {
  if (doc === null) { await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; }); return; }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, doc, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600).catch(() => undefined);
  } finally { await fs.unlink(tmp).catch(() => undefined); }
}
async function names(dir: string): Promise<string[]> {
  try {
    for (const item of [path.dirname(dir), dir]) {
      const st = await fs.lstat(item);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('历史或归档目录不能是符号链接');
    }
    return (await fs.readdir(dir)).filter(n => /^\d+-[a-f0-9-]{36}\.json$/.test(n)).sort().reverse();
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export async function recordHistory(file: string, before: string | null, after: string | null, label: string): Promise<void> {
  if (before === after) return;
  const dir = directory(file, 'history');
  await safeDirectory(dir);
  const id = `${Date.now()}-${randomUUID()}`;
  const item: HistoryRecord = { id, createdAt: new Date().toISOString(), label, before, afterHash: documentHash(after) };
  const doc = JSON.stringify(item);
  if (Buffer.byteLength(doc) > DOCUMENT_LIMIT) throw new Error('历史快照超过 16 MiB，写入已取消');
  await fs.writeFile(path.join(dir, `${id}.json`), doc, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  for (const name of (await names(dir)).slice(HISTORY_LIMIT)) await fs.unlink(path.join(dir, name));
}
export async function listHistory(file: string): Promise<HistoryRecord[]> {
  const dir = directory(file, 'history');
  const result: HistoryRecord[] = [];
  for (const name of (await names(dir)).slice(0, HISTORY_LIMIT)) {
    const doc = await readMemoryDocument(path.join(dir, name));
    if (!doc) continue;
    const item = JSON.parse(doc) as HistoryRecord;
    if (item.id !== name.slice(0, -5) || (item.before !== null && typeof item.before !== 'string') || typeof item.createdAt !== 'string' || typeof item.label !== 'string') throw new Error('历史记录格式无效');
    result.push(item);
  }
  return result;
}
export async function restoreHistory(file: string, id: string, expectedHash: string, lock: string, maxBytes: number,
  validate: (doc: string | null) => void = () => {}, afterRestore: () => Promise<void> = async () => {}): Promise<void> {
  await withDocumentLock(lock, async () => {
    const current = await readMemoryDocument(file);
    if (documentHash(current) !== expectedHash) throw new Error('记忆已发生变化，请刷新后重新确认恢复');
    const snapshot = (await listHistory(file)).find(item => item.id === id);
    if (!snapshot) throw new Error('历史快照不存在或已过保留期限');
    if (snapshot.before !== null && Buffer.byteLength(snapshot.before) > maxBytes) throw new Error('历史内容超过当前容量，先提高容量再恢复');
    validate(snapshot.before);
    await recordHistory(file, current, snapshot.before, 'restore');
    try { await atomicMemoryWrite(file, snapshot.before); await afterRestore(); }
    catch (error) { await atomicMemoryWrite(file, current); await afterRestore(); throw error; }
  });
}

export interface ArchiveRecord { id: string; createdAt: string; entries: import('./profile.ts').ProfileEntry[] }
/** Preserve complete entries before eviction or truncation; never silently prune archives. */
export async function archiveEntries(file: string, entries: ArchiveRecord['entries']): Promise<string | null> {
  if (entries.length === 0) return null;
  const dir = directory(file, 'archive');
  await safeDirectory(dir);
  const existing = await names(dir);
  let bytes = 0;
  for (const name of existing) bytes += (await fs.lstat(path.join(dir, name))).size;
  const id = `${Date.now()}-${randomUUID()}`;
  const doc = JSON.stringify({ id, createdAt: new Date().toISOString(), entries });
  if (Buffer.byteLength(doc) > DOCUMENT_LIMIT) throw new Error('单份归档超过 16 MiB，写入已取消');
  if (existing.length >= 1000 || bytes + Buffer.byteLength(doc) > 64 * 1024 * 1024) throw new Error('归档已达到 1000 份或 64 MiB 上限；清理归档或提高活动容量后再写入');
  const target = path.join(dir, `${id}.json`);
  await fs.writeFile(target, doc, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return target;
}
export async function listArchives(file: string): Promise<ArchiveRecord[]> {
  const dir = directory(file, 'archive');
  const result: ArchiveRecord[] = [];
  for (const name of await names(dir)) {
    const doc = await readMemoryDocument(path.join(dir, name));
    if (doc) { const item = JSON.parse(doc) as ArchiveRecord; if (item.id !== name.slice(0, -5) || !Array.isArray(item.entries)) throw new Error('归档格式无效'); result.push(item); }
  }
  return result;
}
