import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { createMemoryStore, DEFAULT_MAX_BYTES } from './store.ts';
import { parseProfile, RESERVED_KEYS, validateKey, renderEntriesBudgeted } from './profile.ts';
import { createStoredWorkspaceMemory, createWorkspaceMemory, normalizeTopic, parseTopicFile, TOPIC_MAX_BYTES, buildIndexText, type WorkspaceMode } from './workspace.ts';
import { exportMemoryBundle, parseMemoryBundle, previewMemoryBundle, applyMemoryBundle, rollbackMemoryImport, type MigrationOptions, type ImportOptions } from './migration.ts';
import { atomicMemoryWrite, documentHash, readMemoryDocument, listHistory, restoreHistory, listArchives } from './history.ts';
import { memoryPromptPreview } from './prompt.ts';
import { withDocumentLock } from './lock.ts';

export interface ManagerOptions extends MigrationOptions {
  projectPath?: string;
  promptMaxBytes?: number;
  workspacePromptMaxBytes?: number;
  includeInPrompt?: boolean;
  staleAfterDays?: number;
}
function text(value: unknown, name: string): string { if (typeof value !== 'string') throw new Error(`${name} 必须是文本`); return value; }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求格式无效'); return value as Record<string, unknown>; }

export function createMemoryManager(options: ManagerOptions = {}) {
  const profile = path.resolve(options.profilePath || dshHomePath('user-memory', 'user.md'));
  const base = path.resolve(options.workspaceBase || dshHomePath('user-memory', 'workspace'));
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > 16 * 1024 * 1024) throw new Error('画像容量必须是 1 到 16 MiB 之间的整数');
  const store = createMemoryStore({ path: profile, maxBytes });
  const migration = { profilePath: profile, workspaceBase: base, maxBytes, workspaceMode: options.workspaceMode };
  async function project(id: string) {
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error('项目 ID 无效');
    const dir = path.join(base, id);
    for (const item of [base, dir]) { const st = await fs.lstat(item); if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('项目目录无效'); }
    const index = await readMemoryDocument(path.join(dir, 'MEMORY.md'));
    const source = /^<!-- ws: (.*?) -->$/m.exec(index ?? '')?.[1] ?? '';
    return createStoredWorkspaceMemory(dir, source);
  }
  async function target(input: Record<string, unknown>) {
    if (input.scope === 'global') return { file: profile, lock: `${profile}.lock`, max: maxBytes, ws: null };
    if (input.scope !== 'workspace') throw new Error('记忆范围无效');
    const ws = await project(text(input.projectId, '项目 ID'));
    const key = text(input.key, '主题'); const checked = normalizeTopic(key);
    if (!checked.ok) throw new Error(checked.error);
    const old = await ws.read(key);
    return { file: path.join(ws.dir, `${old?.topic ?? checked.topic}.md`), lock: path.join(ws.dir, '.lock'), max: TOPIC_MAX_BYTES + 2048, ws };
  }
  async function snapshot(projectId = '') {
    const bundle = await exportMemoryBundle(migration);
    const ws = projectId ? await project(projectId) : null;
    const { entries, revision } = await withDocumentLock(ws ? path.join(ws.dir, '.lock') : `${profile}.lock`, async () => {
      const doc = await readMemoryDocument(profile);
      const revision = documentHash(doc);
      const entries = ws ? (await ws.list()).map(t => ({ key: t.topic, value: t.body, updatedAt: t.updatedAt, invalidatedAt: t.invalidatedAt, invalidReason: t.invalidReason, revision: '' }))
        : parseProfile(doc ?? '').filter(e => !RESERVED_KEYS.has(e.key)).map(e => ({ ...e, revision }));
      if (ws) for (const e of entries) e.revision = documentHash(await readMemoryDocument(path.join(ws.dir, `${e.key}.md`)));
      return { entries, revision };
    });
    const archives = await listArchives(profile);
    const active = (await store.list()).filter(e => !e.invalidatedAt);
    const budgeted = renderEntriesBudgeted(active, options.promptMaxBytes ?? 2048);
    return { entries, revision,
      projects: bundle.projects.map(p => ({ id: p.id, sourcePath: p.sourcePath, topics: p.topics.length })),
      stats: { profileEntries: bundle.profile.length, projectTopics: bundle.projects.reduce((n, p) => n + p.topics.length, 0),
        activeBytes: Buffer.byteLength(await store.read()), maxBytes, archivedEntries: archives.reduce((n, a) => n + a.entries.length, 0),
        promptOmitted: options.includeInPrompt === false ? active.length : options.promptMaxBytes === 0 ? 0 : budgeted.omitted },
      paths: { profile, workspaceBase: base }, workspaceMode: options.workspaceMode ?? 'directory',
      promptPreview: options.includeInPrompt === false ? '' : memoryPromptPreview(store, ws?.path || options.projectPath, options.promptMaxBytes ?? 2048,
        options.staleAfterDays ?? 0, options.workspacePromptMaxBytes ?? 512, base, options.workspaceMode, options.projectPath) };
  }
  async function action(raw: unknown): Promise<unknown> {
    const input = object(raw); const action = text(input.action, '操作');
    if (action === 'snapshot') return snapshot(typeof input.projectId === 'string' ? input.projectId : '');
    if (action === 'export') return exportMemoryBundle(migration);
    if (action === 'inspect-import') { const b = parseMemoryBundle(text(input.doc, '导出文件')); return { profileEntries: b.profile.length, projects: b.projects.map(p => ({ id: p.id, sourcePath: p.sourcePath, topics: p.topics.length })) }; }
    if (action === 'preview-import' || action === 'apply-import') {
      const config = object(input.options);
      const opts: ImportOptions = { ...migration, includeProfile: config.includeProfile !== false,
        policy: config.policy === 'use-imported' ? 'use-imported' : 'keep-local', projectMap: config.projectMap as ImportOptions['projectMap'] };
      if (!Array.isArray(opts.projectMap)) throw new Error('项目映射必须是列表');
      return action === 'preview-import' ? previewMemoryBundle(text(input.doc, '导出文件'), opts)
        : applyMemoryBundle(text(input.doc, '导出文件'), text(input.previewToken, '预览确认'), opts);
    }
    if (action === 'rollback-import') { await rollbackMemoryImport(text(input.backupPath, '备份'), migration); return { restored: true }; }
    if (action === 'archives') return listArchives(profile);
    if (action === 'restore-archive') {
      const key = text(input.key, '条目');
      const item = (await listArchives(profile)).find(a => a.id === input.id)?.entries.find(e => e.key === key);
      if (!item) throw new Error('归档条目不存在');
      const entries = await store.list(); const current = entries.find(e => e.key === key) ?? null;
      if (current && input.replace !== true) throw new Error('本机已有同名记忆，请明确确认替换');
      if (documentHash(await readMemoryDocument(profile)) !== input.revision) throw new Error('记忆已变化，请刷新');
      const result = await store.update(key, item.value, 'set', '', { expected: current, expectedDocumentHash: text(input.revision, '版本') }, !!item.pinned);
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    const t = await target(input);
    if (action === 'set-pinned') {
      if (t.ws) throw new Error('置顶仅适用于用户记忆');
      if (typeof input.pinned !== 'boolean') throw new Error('置顶状态必须是布尔值');
      const key = text(input.key, '条目'), revision = text(input.revision, '版本');
      const current = (await store.list()).find(e => e.key === key) ?? null;
      const result = await store.setPinned(key, input.pinned, { expected: current, expectedDocumentHash: revision });
      if (!result.ok) throw new Error(result.error); return result;
    }
    if (action === 'history') return { revision: documentHash(await readMemoryDocument(t.file)), records: await listHistory(t.file) };
    if (action === 'restore-history') {
      await restoreHistory(t.file, text(input.id, '快照'), text(input.revision, '版本'), t.lock, t.max,
        doc => { if (doc === null) return; if (t.ws) { const topic = parseTopicFile(doc); if (topic.topic !== input.key || Buffer.byteLength(topic.body) > TOPIC_MAX_BYTES) throw new Error('历史主题无效'); }
          else for (const e of parseProfile(doc)) if (!RESERVED_KEYS.has(e.key) && validateKey(e.key)) throw new Error('历史画像无效'); },
        async () => { if (t.ws) await atomicMemoryWrite(path.join(t.ws.dir, 'MEMORY.md'), buildIndexText(await t.ws.list(), t.ws.path)); });
      return { restored: true };
    }
    if (action !== 'update') throw new Error('未知操作');
    const key = text(input.key, '条目'); const mode = input.mode;
    if (!['set', 'append', 'invalidate', 'remove'].includes(String(mode))) throw new Error('写入方式无效');
    const revision = text(input.revision, '版本');
    if (documentHash(await readMemoryDocument(t.file)) !== revision) throw new Error('记忆已发生变化，请刷新后编辑');
    const value = text(input.value, '内容'); const reason = typeof input.reason === 'string' ? input.reason : '';
    // The guard repeats validation under the store lock, preventing stale browser edits.
    if (t.ws) {
      if (input.pinned !== undefined) throw new Error('置顶仅适用于用户记忆');
      const current = await t.ws.read(key) ?? null;
      if (input.createOnly === true && current) throw new Error('同名主题已经存在，请使用编辑');
      if (documentHash(await readMemoryDocument(t.file)) !== revision) throw new Error('记忆已变化，请刷新');
      const result = await t.ws.write(key, value, mode as 'set', reason, current, undefined, revision);
      if (!result.ok) throw new Error(result.error); return result;
    }
    const current = (await store.list()).find(e => e.key === key) ?? null;
    if (input.createOnly === true && current) throw new Error('同名条目已经存在，请使用编辑');
    if (documentHash(await readMemoryDocument(profile)) !== revision) throw new Error('记忆已变化，请刷新');
    if (input.pinned !== undefined && typeof input.pinned !== 'boolean') throw new Error('置顶状态必须是布尔值');
    const result = await store.update(key, value, mode as 'set', reason, { expected: current, expectedDocumentHash: revision }, input.pinned as boolean | undefined);
    if (!result.ok) throw new Error(result.error); return result;
  }
  async function diagnose(cwd?: string) {
    let workspace: unknown = null; let workspaceError = '';
    const projectCwd = options.projectPath || cwd;
    if (projectCwd) try { const ws = await createWorkspaceMemory({ cwd: projectCwd, baseDir: base, mode: options.workspaceMode, projectPath: options.projectPath }); workspace = { path: ws.path, storage: ws.dir, topics: (await ws.list()).length }; }
      catch (error) { workspaceError = (error as Error).message; }
    const state = await snapshot();
    return { profile, workspaceBase: base, workspace, workspaceError, ...state.stats,
      includeInPrompt: options.includeInPrompt !== false, workspaceMode: options.workspaceMode ?? 'directory',
      note: 'CLI 诊断读取指定文件与选项；插件工具诊断使用运行中的插件配置。此结果不代表模型一定会采用记忆。' };
  }
  return { action, snapshot, diagnose };
}
