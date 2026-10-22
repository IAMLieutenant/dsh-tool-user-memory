import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { createMemoryStore, DEFAULT_MAX_BYTES } from './store.ts';
import { parseProfile, RESERVED_KEYS, validateKey, renderEntriesBudgeted } from './profile.ts';
import { createStoredWorkspaceMemory, createWorkspaceMemory, normalizeTopic, parseTopicFile, TOPIC_MAX_BYTES, buildIndexText, type WorkspaceMode } from './workspace.ts';
import { exportMemoryBundle, parseMemoryBundle, previewMemoryBundle, applyMemoryBundle, rollbackMemoryImport, type MigrationOptions, type ImportOptions } from './migration.ts';
import { atomicMemoryWrite, documentHash, readMemoryDocument, listHistory, restoreHistory, listArchives } from './history.ts';
import { memoryPromptSnapshot } from './prompt.ts';
import { withDocumentLock } from './lock.ts';
import { createCandidateStore, type MemoryCandidate } from './candidates.ts';
import type { MemoryProvenance } from './provenance.ts';
import { workspaceHashOf } from './workspace.ts';
import { sourceWorkspace, type MemoryActivity } from './activity.ts';
import { createMemoryPolicy, type MemoryPolicyStore } from './policy.ts';
import { createAutomaticMemory } from './auto-memory.ts';

export interface ManagerOptions extends MigrationOptions {
  /** False is reserved for old integrations/tests; normal UI handles user memory only. */
  userOnly?: boolean;
  usagePolicy?: MemoryPolicyStore;
  activity?: MemoryActivity;
  projectPath?: string;
  promptMaxBytes?: number;
  workspacePromptMaxBytes?: number;
  includeInPrompt?: boolean;
  staleAfterDays?: number;
}
function text(value: unknown, name: string): string { if (typeof value !== 'string') throw new Error(`${name} 必须是文本`); return value; }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求格式无效'); return value as Record<string, unknown>; }

export function createMemoryManager(options: ManagerOptions = {}) {
  const userOnly = options.userOnly !== false;
  const profile = path.resolve(options.profilePath || dshHomePath('user-memory', 'user.md'));
  const base = path.resolve(options.workspaceBase || dshHomePath('user-memory', 'workspace'));
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > 16 * 1024 * 1024) throw new Error('画像容量必须是 1 到 16 MiB 之间的整数');
  const store = createMemoryStore({ path: profile, maxBytes });
  const candidates = createCandidateStore(profile);
  const policy = options.usagePolicy ?? createMemoryPolicy(profile, userOnly ? { mode: options.includeInPrompt === false ? 'paused' : 'shared', inject: options.includeInPrompt !== false } : { inject: options.includeInPrompt === true }, userOnly);
  const migration = { profilePath: profile, workspaceBase: base, maxBytes, workspaceMode: options.workspaceMode };
  const automatic = createAutomaticMemory(store, policy);
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
    if (userOnly) throw new Error('这里只保存用户记忆。');
    if (input.scope !== 'workspace') throw new Error('记忆范围无效');
    const ws = await project(text(input.projectId, '项目 ID'));
    const key = text(input.key, '主题'); const checked = normalizeTopic(key);
    if (!checked.ok) throw new Error(checked.error);
    const old = await ws.read(key);
    return { file: path.join(ws.dir, `${old?.topic ?? checked.topic}.md`), lock: path.join(ws.dir, '.lock'), max: TOPIC_MAX_BYTES + 2048, ws };
  }
  async function snapshot(projectId = '') {
    const settings = policy.snapshot();
    const bundle = userOnly ? { profile: await store.list(), projects: [] } : await exportMemoryBundle(migration);
    const pending = (await candidates.list()).filter(c => c.status === 'pending' && (!userOnly || c.scope === 'global'));
    const ws = !userOnly && projectId ? await project(projectId) : null;
    const { entries, revision } = await withDocumentLock(ws ? path.join(ws.dir, '.lock') : `${profile}.lock`, async () => {
      const doc = await readMemoryDocument(profile);
      const revision = documentHash(doc);
      const entries = ws ? (await ws.list()).map(t => ({ key: t.topic, value: t.body, updatedAt: t.updatedAt, invalidatedAt: t.invalidatedAt, invalidReason: t.invalidReason, provenance: t.provenance, revision: '' }))
        : parseProfile(doc ?? '').filter(e => !RESERVED_KEYS.has(e.key)).map(e => ({ ...e, revision }));
      if (ws) for (const e of entries) e.revision = documentHash(await readMemoryDocument(path.join(ws.dir, `${e.key}.md`)));
      return { entries, revision };
    });
    const archives = await listArchives(profile);
    const active = (await store.list()).filter(e => !e.invalidatedAt);
    const budgeted = renderEntriesBudgeted(active, options.promptMaxBytes ?? 2048);
    return { entries, revision, settings, enabled: settings.values.mode === 'shared' && settings.values.inject,
      candidates: pending.map(c => ({ ...c, revision: documentHash(JSON.stringify(c)), projectId: c.workspacePath ? workspaceHashOf(c.workspacePath) : '' })),
      projects: bundle.projects.map(p => ({ id: p.id, sourcePath: p.sourcePath, topics: p.topics.length })),
      stats: { profileEntries: bundle.profile.length, projectTopics: bundle.projects.reduce((n, p) => n + p.topics.length, 0),
        activeBytes: Buffer.byteLength(await store.read()), maxBytes, archivedEntries: archives.reduce((n, a) => n + a.entries.length, 0),
        promptOmitted: !settings.values.inject || settings.values.mode !== 'shared' ? active.length : options.promptMaxBytes === 0 ? 0 : budgeted.omitted },
      paths: { profile, workspaceBase: base }, workspaceMode: options.workspaceMode ?? 'directory',
      promptPreview: memoryPromptSnapshot(store, userOnly ? undefined : ws?.path || options.projectPath, options.promptMaxBytes ?? 2048,
        options.staleAfterDays ?? 0, userOnly ? 0 : options.workspacePromptMaxBytes ?? 512, base, options.workspaceMode, userOnly ? '' : options.projectPath,
        settings.values.inject && settings.values.mode !== 'paused', settings.values.mode === 'shared').text };
  }
  async function candidateTarget(c: MemoryCandidate, input: Record<string, unknown>) {
    if (userOnly && (c.scope !== 'global' || input.scope !== 'global')) throw new Error('这里只保存用户记忆，不转换旧项目记忆。');
    const key = text(input.key, '名称').trim(), value = text(input.value, '内容');
    if (validateKey(key) || RESERVED_KEYS.has(key) || !value.trim() || value.length > 12000) throw new Error('请填写有效的名称和内容');
    if (input.scope === 'global') return { file: profile, key, value, ws: null };
    if (input.scope !== 'workspace' || !c.workspacePath || input.projectId !== workspaceHashOf(c.workspacePath)) throw new Error('请选择用户记忆或候选的来源项目');
    const ws = await createWorkspaceMemory({ cwd: c.workspacePath, baseDir: base, mode: options.workspaceMode, projectPath: c.workspacePath });
    if (!normalizeTopic(key).ok) throw new Error('项目记忆名称无效');
    const old = await ws.read(key);
    return { file: path.join(ws.dir, `${old?.topic ?? key}.md`), key: old?.topic ?? key, value, ws };
  }
  async function candidatePlan(c: MemoryCandidate, input: Record<string, unknown>) {
    const t = await candidateTarget(c, input), doc = await readMemoryDocument(t.file);
    const existing = t.ws ? await t.ws.read(t.key) ?? null : (await store.list()).find(e => e.key === t.key) ?? null;
    const before = existing ? ('body' in existing ? existing.body : existing.value) : '';
    const pinned = typeof input.pinned === 'boolean' ? input.pinned : !!(existing && 'pinned' in existing && existing.pinned);
    const token = documentHash(JSON.stringify({ candidate: c, file: t.file, key: t.key, value: t.value, pinned, revision: documentHash(doc) }));
    return { t, existing, before, pinned, revision: documentHash(doc), token };
  }
  async function action(raw: unknown): Promise<unknown> {
    const input = object(raw); const action = text(input.action, '操作');
    if (action === 'snapshot') return snapshot(typeof input.projectId === 'string' ? input.projectId : '');
    if (action === 'automatic-notices') {
      if (!Number.isSafeInteger(input.turn) || (input.turn as number) < 0) throw new Error('轮次无效');
      return automatic.notices(text(input.sessionId, '会话'), input.turn as number);
    }
    if (action === 'undo-automatic') return automatic.undo(text(input.key, '记忆'), text(input.id, '记录'));
    if (action === 'set-enabled') {
      if (typeof input.enabled !== 'boolean') throw new Error('开关值无效');
      return policy.save({ mode: input.enabled ? 'shared' : 'paused', inject: input.enabled, diagnostics: false }, text(input.revision, '使用设置版本'));
    }
    if (action === 'save-settings') { if (userOnly) throw new Error('请使用记忆启用开关。'); return policy.save(input.values, text(input.revision, '使用设置版本')); }
    if (action === 'receipts') {
      if (input.turn !== undefined && (!Number.isSafeInteger(input.turn) || (input.turn as number) < 0)) throw new Error('轮次无效');
      return options.activity ? options.activity.receipts(typeof input.sessionId === 'string' ? input.sessionId : undefined, input.turn as number | undefined) : { records: [], warning: '当前独立管理服务没有接入运行中的会话记录。' };
    }
    if (action === 'clear-receipts') { if (!options.activity) throw new Error('当前没有会话记录服务'); await options.activity.clear(); return { cleared: true }; }
    if (action === 'source-messages') {
      if (!options.activity) throw new Error('请从运行中的 DSH 消息下方打开“记住”');
      if (!Number.isSafeInteger(input.turn) || (input.turn as number) < 0) throw new Error('轮次无效');
      return { messages: options.activity.messages(text(input.sessionId, '会话'), input.turn as number).map(m => ({ ...m, hasWorkspace: !!(m.cwd || options.projectPath) })) };
    }
    if (action === 'propose-message') {
      if (!options.activity) throw new Error('当前没有会话记录服务');
      const sid = text(input.sessionId, '来源会话'), excerpt = text(input.excerpt, '原话');
      if (!Number.isSafeInteger(input.seq) || (input.seq as number) < 0) throw new Error('消息位置无效');
      const source = options.activity.source(sid, input.seq as number, excerpt);
      if (userOnly && input.scope !== undefined && input.scope !== 'global') throw new Error('这里只保存用户记忆。');
      if (!userOnly && !['global', 'workspace'].includes(String(input.scope))) throw new Error('请选择保存范围');
      const workspacePath = userOnly ? undefined : sourceWorkspace(source.cwd, options.workspaceMode, options.projectPath);
      if (input.scope === 'workspace' && !workspacePath) throw new Error('来源会话没有项目目录，请选择用户记忆');
      const c = await candidates.propose({ key: text(input.key, '名称').trim(), value: text(input.value, '内容'), scope: userOnly ? 'global' : input.scope as 'global' | 'workspace',
        ...(workspacePath ? { workspacePath } : {}), sourceSessionId: sid, sourceEventSeq: source.message.seq,
        sourceRole: source.message.role, excerptVerified: true, excerpt, reason: '用户从消息操作中选取，等待核对保存' });
      return { candidate: { ...c, revision: documentHash(JSON.stringify(c)), projectId: workspacePath ? workspaceHashOf(workspacePath) : '' } };
    }
    if (action === 'preview-candidate') {
      const c = (await candidates.list()).find(c => c.id === input.id && c.status === 'pending');
      if (!c || documentHash(JSON.stringify(c)) !== input.revision) throw new Error('候选已变化或已处理，请刷新');
      const p = await candidatePlan(c, input);
      return { previewToken: p.token, before: p.before, replacing: !!p.existing, after: p.t.value,
        scope: p.t.ws ? 'workspace' : 'global', key: p.t.key, sourcePath: p.t.ws?.path ?? '', pinned: p.pinned };
    }
    if (action === 'accept-candidate' || action === 'dismiss-candidate') {
      return candidates.review(text(input.id, '候选'), text(input.revision, '候选版本'), action === 'accept-candidate' ? 'accepted' : 'dismissed', async c => {
        if (action === 'dismiss-candidate') {
          const globalSaved = (await store.list()).some(e => e.provenance?.candidateId === c.id);
          const projectSaved = c.workspacePath ? (await (await createWorkspaceMemory({ cwd: c.workspacePath, baseDir: base, projectPath: c.workspacePath })).list()).some(e => e.provenance?.candidateId === c.id) : false;
          if (globalSaved || projectSaved) throw new Error('这条候选已写入记忆，请到“记忆”中核对；不能用忽略撤销已保存的内容');
          return { dismissed: true };
        }
        const p = await candidatePlan(c, input);
        if (p.existing?.provenance?.candidateId === c.id && p.before === p.t.value) return { saved: true, recovered: true };
        if (p.token !== input.previewToken) throw new Error('候选、范围或记忆已变化，请重新预览后确认');
        const now = new Date().toISOString();
        const provenance: MemoryProvenance = { createdAt: p.existing?.provenance?.createdAt || now,
          confirmedAt: now, method: 'candidate', candidateId: c.id,
          ...(c.sourceSessionId ? { sourceSessionId: c.sourceSessionId } : {}), ...(c.excerpt ? { excerpt: c.excerpt } : {}),
          ...(c.excerptVerified !== undefined ? { excerptVerified: c.excerptVerified } : {}), ...(c.sourceEventSeq !== undefined ? { sourceEventSeq: c.sourceEventSeq } : {}),
          ...(c.sourceRole ? { sourceRole: c.sourceRole } : {}),
          ...(p.before && p.before.length <= 16384 ? { previousValue: p.before } : {}) };
        const result = p.t.ws
          ? await p.t.ws.write(p.t.key, p.t.value, 'set', '', await p.t.ws.read(p.t.key) ?? null, undefined, p.revision, provenance)
          : await store.update(p.t.key, p.t.value, 'set', '', { expected: (await store.list()).find(e => e.key === p.t.key) ?? null, expectedDocumentHash: p.revision }, p.pinned, provenance, true);
        if (!result.ok) throw new Error(result.error); return { saved: true, replaced: !!p.existing };
      });
    }
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
      const provenance: MemoryProvenance = { createdAt: current?.provenance?.createdAt || new Date().toISOString(), method: 'manual', confirmedAt: new Date().toISOString(), ...(current?.body && current.body !== value && current.body.length <= 16384 ? { previousValue: current.body } : {}) };
      const result = await t.ws.write(key, value, mode as 'set', reason, current, undefined, revision, provenance);
      if (!result.ok) throw new Error(result.error); return result;
    }
    const current = (await store.list()).find(e => e.key === key) ?? null;
    if (input.createOnly === true && current) throw new Error('同名条目已经存在，请使用编辑');
    if (documentHash(await readMemoryDocument(profile)) !== revision) throw new Error('记忆已变化，请刷新');
    if (input.pinned !== undefined && typeof input.pinned !== 'boolean') throw new Error('置顶状态必须是布尔值');
    const provenance: MemoryProvenance = { createdAt: current?.provenance?.createdAt || new Date().toISOString(), method: 'manual', confirmedAt: new Date().toISOString(), ...(current?.value && current.value !== value && current.value.length <= 16384 ? { previousValue: current.value } : {}) };
    const result = await store.update(key, value, mode as 'set', reason, { expected: current, expectedDocumentHash: revision }, input.pinned as boolean | undefined, mode === 'set' || mode === 'append' ? provenance : undefined);
    if (!result.ok) throw new Error(result.error); return result;
  }
  async function diagnose(cwd?: string, currentProjectOnly = false) {
    let workspace: unknown = null; let workspaceError = '';
    const projectCwd = options.projectPath || cwd;
    if (!userOnly && projectCwd) try { const ws = await createWorkspaceMemory({ cwd: projectCwd, baseDir: base, mode: options.workspaceMode, projectPath: options.projectPath }); workspace = { path: ws.path, storage: ws.dir, topics: (await ws.list()).length }; }
      catch (error) { workspaceError = (error as Error).message; }
    const state = currentProjectOnly ? { stats: {} } : await snapshot();
    return { profile, workspaceBase: base, workspace, workspaceError, ...state.stats,
      policy: policy.snapshot(), includeInPrompt: policy.read().inject && policy.read().mode !== 'paused', workspaceMode: options.workspaceMode ?? 'directory',
      note: 'CLI 诊断读取指定文件与选项；插件工具诊断使用运行中的插件配置。此结果不代表模型一定会采用记忆。' };
  }
  return { action, snapshot, diagnose };
}
