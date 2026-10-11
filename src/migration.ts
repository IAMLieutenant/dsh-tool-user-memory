/** Portable snapshots and guarded, reversible imports. No model rewriting. */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { withDocumentLock } from './lock.ts';
import { recordHistory } from './history.ts';
import { RESERVED_KEYS, parseProfile, serializeProfile, validateKey, type ProfileEntry } from './profile.ts';
import { TOPIC_MAX_BYTES, buildIndexText, normalizeTopic, parseTopicFile, serializeTopicFile,
  workspaceLocation, projectDirectory, type WorkspaceMode, type WorkspaceTopic } from './workspace.ts';

export const BUNDLE_MAX_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 10_000;
const DEFAULT_PROFILE_MAX_BYTES = 8192;

export interface MemoryBundle {
  format: 'dsh-user-memory';
  version: 1;
  exportedAt: string;
  profile: ProfileEntry[];
  projects: { id: string; sourcePath: string; topics: WorkspaceTopic[] }[];
}
export interface MigrationOptions {
  profilePath?: string;
  workspaceBase?: string;
  maxBytes?: number;
  workspaceMode?: WorkspaceMode;
}
export type ConflictPolicy = 'keep-local' | 'use-imported';
export interface ProjectMapping { id: string; path: string }
export interface ImportOptions extends MigrationOptions {
  includeProfile?: boolean;
  projectMap?: ProjectMapping[];
  policy?: ConflictPolicy;
}
export interface ImportSummary {
  added: number;
  replaced: number;
  kept: number;
  identical: number;
  conflicts: string[];
}
export interface ImportPreview {
  profile: ImportSummary | null;
  projects: { id: string; sourcePath: string; targetPath: string; summary: ImportSummary }[];
  unmapped: { id: string; sourcePath: string; topics: number }[];
  policy: ConflictPolicy;
  filesToWrite: number;
  previewToken: string;
}
interface FileChange { path: string; before: string | null; after: string }
interface Plan { preview: ImportPreview; files: FileChange[]; locks: string[] }
interface Journal {
  format: 'dsh-memory-import-backup';
  version: 1;
  createdAt: string;
  status: 'pending' | 'completed' | 'rolled-back' | 'rollback-failed';
  locks: string[];
  files: FileChange[];
}

/** Test seam for filesystem failures; not exposed by the plugin or CLI. */
let beforeWrite: ((file: string) => void | Promise<void>) | undefined;
export function setMigrationWriteHook(hook: typeof beforeWrite): () => void {
  const previous = beforeWrite;
  beforeWrite = hook;
  return () => { beforeWrite = previous; };
}

function fail(message: string): never { throw new Error(message); }
function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = BUNDLE_MAX_BYTES): string {
  if (typeof value !== 'string' || value.length > max) fail(`${label} must be a string of at most ${max} characters`);
  return value;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) fail(`${label} must be an array of at most ${MAX_ITEMS} items`);
  return value;
}
function timestamp(value: unknown, label: string, allowEmpty = true): string {
  const stamp = string(value, label, 64);
  if (stamp === '' && allowEmpty) return stamp;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) || !Number.isFinite(Date.parse(stamp))) {
    fail(`${label} must be an ISO timestamp`);
  }
  return stamp;
}
function metadata(item: Record<string, unknown>) {
  const invalidReason = string(item.invalidReason, 'invalidReason', 200);
  if (/[\r\n\x00]/.test(invalidReason)) fail('invalidReason must be a single line');
  return {
    updatedAt: timestamp(item.updatedAt, 'updatedAt'),
    invalidatedAt: timestamp(item.invalidatedAt, 'invalidatedAt'),
    invalidReason,
  };
}
function unique<T>(items: T[], key: (item: T) => string, label: string): T[] {
  const ids = new Set<string>();
  for (const item of items) {
    const id = key(item);
    if (ids.has(id)) fail(`duplicate ${label}: ${id}`);
    ids.add(id);
  }
  return items;
}
function profileEntries(value: unknown): ProfileEntry[] {
  return unique(array(value, 'profile').map(raw => {
    const item = record(raw, 'profile entry');
    const key = string(item.key, 'key', 128);
    if (key !== key.trim() || validateKey(key) || RESERVED_KEYS.has(key) || /[\x00-\x1f]/.test(key)) fail(`invalid profile key: ${key}`);
    if (item.pinned !== undefined && typeof item.pinned !== 'boolean') fail('pinned must be a boolean');
    return { key, value: string(item.value, 'value'), ...metadata(item), ...(item.pinned ? { pinned: true } : {}) };
  }), item => item.key, 'profile key');
}
function topics(value: unknown): WorkspaceTopic[] {
  return unique(array(value, 'topics').map(raw => {
    const item = record(raw, 'topic');
    const topic = string(item.topic, 'topic', 64);
    const normalized = normalizeTopic(topic);
    if (!normalized.ok || normalized.topic !== topic) fail(`invalid topic name: ${topic}`);
    const body = string(item.body, 'body');
    if (Buffer.byteLength(body, 'utf8') > TOPIC_MAX_BYTES) fail(`topic exceeds ${TOPIC_MAX_BYTES} bytes: ${topic}`);
    return { topic, body, ...metadata(item) };
  }), item => item.topic.toLowerCase(), 'topic');
}

/** Validate unknown JSON before any destination path or file is used. */
export function parseMemoryBundle(doc: string): MemoryBundle {
  if (Buffer.byteLength(doc, 'utf8') > BUNDLE_MAX_BYTES) fail('memory bundle exceeds 16 MiB');
  const value = record(JSON.parse(doc), 'bundle');
  if (value.format !== 'dsh-user-memory' || value.version !== 1) fail('unsupported memory bundle format or version');
  return {
    format: 'dsh-user-memory', version: 1,
    exportedAt: timestamp(value.exportedAt, 'exportedAt', false),
    profile: profileEntries(value.profile),
    projects: unique(array(value.projects, 'projects').map(raw => {
      const project = record(raw, 'project');
      const id = string(project.id, 'project id', 64);
      if (!/^[a-f0-9]{16}$/.test(id)) fail('invalid project id');
      const sourcePath = string(project.sourcePath, 'sourcePath', 4096);
      if (/[\r\n\x00]/.test(sourcePath)) fail('invalid sourcePath');
      return { id, sourcePath, topics: topics(project.topics) };
    }), item => item.id, 'project id'),
  };
}

function locations(options: MigrationOptions) {
  const maxBytes = options.maxBytes ?? DEFAULT_PROFILE_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) fail('maxBytes must be a positive integer');
  return {
    profile: path.resolve(options.profilePath?.trim() || dshHomePath('user-memory', 'user.md')),
    base: path.resolve(options.workspaceBase?.trim() || dshHomePath('user-memory', 'workspace')),
    maxBytes,
  };
}
function pathKey(file: string): string { return process.platform === 'win32' ? file.toLowerCase() : file; }
function within(base: string, file: string): boolean {
  const rel = path.relative(base, file);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
async function readDocument(file: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`memory document must be a regular file: ${file}`);
    if (stat.size > BUNDLE_MAX_BYTES) fail(`memory document is too large: ${file}`);
    const doc = await fs.readFile(file, 'utf8');
    if (Buffer.byteLength(doc, 'utf8') > BUNDLE_MAX_BYTES) fail(`memory document is too large: ${file}`);
    return doc;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
async function directoryNames(dir: string): Promise<string[]> {
  try {
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`memory directory must be a regular directory: ${dir}`);
    return (await fs.readdir(dir)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
async function readProject(dir: string) {
  const files: { path: string; doc: string; topic: WorkspaceTopic }[] = [];
  for (const name of await directoryNames(dir)) {
    if (!name.toLowerCase().endsWith('.md') || name.toLowerCase() === 'memory.md') continue;
    const file = path.join(dir, name);
    const doc = await readDocument(file);
    if (doc === null) fail(`topic disappeared while reading: ${file}`);
    const topic = topics([parseTopicFile(doc)])[0]!;
    if (name !== `${topic.topic}.md`) fail(`topic filename and title differ: ${file}`);
    files.push({ path: file, doc, topic });
  }
  unique(files, file => file.topic.topic.toLowerCase(), 'stored topic');
  const indexPath = path.join(dir, 'MEMORY.md');
  const index = await readDocument(indexPath);
  return { files, indexPath, index };
}

/** Enumerates stored projects even when their original working directory is gone. */
export async function exportMemoryBundle(options: MigrationOptions = {}, scope: 'all' | 'global' = 'all'): Promise<MemoryBundle> {
  const loc = locations(options);
  const profile = await withDocumentLock(`${loc.profile}.lock`, async () =>
    profileEntries(parseProfile(await readDocument(loc.profile) ?? '').filter(e => !RESERVED_KEYS.has(e.key))));
  const projects: MemoryBundle['projects'] = [];
  if (scope === 'all') {
    for (const id of await directoryNames(loc.base)) {
      if (!/^[a-f0-9]{16}$/.test(id)) continue;
      const dir = path.join(loc.base, id);
      // Refuse a redirected directory before the lock could follow it.
      await directoryNames(dir);
      await withDocumentLock(path.join(dir, '.lock'), async () => {
        const stored = await readProject(dir);
        if (stored.files.length === 0 && stored.index === null) return;
        const sourcePath = /^<!-- ws: (.*?) -->$/m.exec((stored.index ?? '').replace(/\r\n/g, '\n'))?.[1] ?? '';
        projects.push({ id, sourcePath, topics: stored.files.map(file => file.topic) });
      });
    }
  }
  const bundle: MemoryBundle = { format: 'dsh-user-memory', version: 1, exportedAt: new Date().toISOString(), profile, projects };
  return parseMemoryBundle(JSON.stringify(bundle));
}

/** Exclusive destination creation: export never overwrites an existing file. */
export async function exportMemoryFile(destination: string, options: MigrationOptions = {}, scope: 'all' | 'global' = 'all') {
  const file = path.resolve(destination);
  const loc = locations(options);
  if (pathKey(file) === pathKey(loc.profile) || pathKey(file) === pathKey(`${loc.profile}.lock`) || within(loc.base, file) || within(path.join(path.dirname(loc.profile), 'migration-backups'), file)) {
    fail('export destination must be outside the live memory files and migration backups');
  }
  const bundle = await exportMemoryBundle(options, scope);
  const doc = JSON.stringify(bundle, null, 2) + '\n';
  if (Buffer.byteLength(doc, 'utf8') > BUNDLE_MAX_BYTES) fail('formatted memory bundle exceeds 16 MiB');
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, doc, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { file, profileEntries: bundle.profile.length, projects: bundle.projects.map(p => ({ id: p.id, sourcePath: p.sourcePath, topics: p.topics.length })) };
}

function merge<T>(local: T[], incoming: T[], key: (item: T) => string, policy: ConflictPolicy, preserveName: (incoming: T, local: T) => T) {
  const summary: ImportSummary = { added: 0, replaced: 0, kept: 0, identical: 0, conflicts: [] };
  const result = new Map(local.map(item => [key(item), item]));
  for (const entry of incoming) {
    const id = key(entry);
    const old = result.get(id);
    if (old === undefined) { result.set(id, entry); summary.added++; continue; }
    const normalized = preserveName(entry, old);
    if (JSON.stringify(old) === JSON.stringify(normalized)) { summary.identical++; continue; }
    summary.conflicts.push(id);
    if (policy === 'keep-local') summary.kept++;
    else { result.set(id, normalized); summary.replaced++; }
  }
  return { next: [...result.values()], summary };
}

async function mappedProjects(bundle: MemoryBundle, options: ImportOptions) {
  const result: { project: MemoryBundle['projects'][number]; targetPath: string; dir: string }[] = [];
  const ids = new Set<string>();
  const destinations = new Set<string>();
  const loc = locations(options);
  for (const mapping of options.projectMap ?? []) {
    if (typeof mapping.id !== 'string' || typeof mapping.path !== 'string' || mapping.path.trim() === '' || /[\r\n\x00]/.test(mapping.path)) fail('invalid project mapping');
    if (ids.has(mapping.id)) fail(`duplicate project mapping: ${mapping.id}`);
    ids.add(mapping.id);
    const project = bundle.projects.find(p => p.id === mapping.id);
    if (!project) fail(`unknown exported project: ${mapping.id}`);
    const targetPath = projectDirectory(mapping.path, options.workspaceMode);
    if (/[\r\n\x00]/.test(targetPath)) fail('target project path must be a single line');
    if (!(await fs.stat(targetPath)).isDirectory()) fail(`target project is not a directory: ${targetPath}`);
    const dir = workspaceLocation(targetPath, loc.base);
    if (destinations.has(pathKey(dir))) fail('multiple imported projects cannot target the same directory');
    destinations.add(pathKey(dir));
    if (within(dir, loc.profile)) fail('profile path overlaps a target workspace memory directory');
    await directoryNames(dir);
    result.push({ project, targetPath, dir });
  }
  return result;
}

async function prepare(bundle: MemoryBundle, options: ImportOptions): Promise<Plan> {
  const loc = locations(options);
  const policy = options.policy ?? 'keep-local';
  if (policy !== 'keep-local' && policy !== 'use-imported') fail('invalid conflict policy');
  const mapped = await mappedProjects(bundle, options);
  const files: FileChange[] = [];
  // Read-set includes unchanged files, so a later edit invalidates approval too.
  const snapshots: { path: string; doc: string | null }[] = [];
  const locks: string[] = [];
  let profile: ImportSummary | null = null;
  if (options.includeProfile !== false) {
    locks.push(`${loc.profile}.lock`);
    const before = await readDocument(loc.profile);
    snapshots.push({ path: loc.profile, doc: before });
    const current = profileEntries(parseProfile(before ?? '').filter(e => !RESERVED_KEYS.has(e.key)));
    const merged = merge(current, bundle.profile, e => e.key, policy, entry => entry);
    profile = merged.summary;
    if (profile.added + profile.replaced > 0) {
      const after = serializeProfile(merged.next);
      if (Buffer.byteLength(after, 'utf8') > loc.maxBytes) fail(`merged profile exceeds ${loc.maxBytes} bytes; nothing was imported (select fewer memories or increase maxBytes)`);
      files.push({ path: loc.profile, before, after });
    }
  }
  const projects: ImportPreview['projects'] = [];
  for (const { project, targetPath, dir } of mapped) {
    locks.push(path.join(dir, '.lock'));
    const stored = await readProject(dir);
    snapshots.push({ path: stored.indexPath, doc: stored.index }, ...stored.files.map(f => ({ path: f.path, doc: f.doc })));
    const merged = merge(stored.files.map(f => f.topic), project.topics, e => e.topic.toLowerCase(), policy,
      (entry, old) => ({ ...entry, topic: old.topic }));
    for (const topic of merged.next) {
      const old = stored.files.find(f => f.topic.topic === topic.topic);
      if (old && JSON.stringify(old.topic) === JSON.stringify(topic)) continue;
      files.push({ path: path.join(dir, `${topic.topic}.md`), before: old?.doc ?? null, after: serializeTopicFile(topic) });
    }
    if (merged.summary.added + merged.summary.replaced > 0) {
      files.push({ path: stored.indexPath, before: stored.index, after: buildIndexText(merged.next, targetPath) });
    }
    projects.push({ id: project.id, sourcePath: project.sourcePath, targetPath, summary: merged.summary });
  }
  unique(files, f => pathKey(f.path), 'destination file');
  if (files.length > MAX_ITEMS) fail(`import would change more than ${MAX_ITEMS} files; split the migration`);
  locks.sort();
  const unmapped = bundle.projects.filter(p => !mapped.some(m => m.project.id === p.id))
    .map(p => ({ id: p.id, sourcePath: p.sourcePath, topics: p.topics.length }));
  const digest = createHash('sha256').update(JSON.stringify({ bundle, policy, maxBytes: loc.maxBytes, snapshots, files, locks })).digest('hex');
  return { files, locks, preview: { profile, projects, unmapped, policy, filesToWrite: files.length, previewToken: digest } };
}

async function loadBundle(source: string): Promise<MemoryBundle> {
  const doc = await readDocument(path.resolve(source));
  if (doc === null) fail('memory bundle file does not exist');
  return parseMemoryBundle(doc);
}
export async function previewMemoryImport(source: string, options: ImportOptions = {}): Promise<ImportPreview> {
  return (await prepare(await loadBundle(source), options)).preview;
}
export async function previewMemoryBundle(doc: string, options: ImportOptions = {}): Promise<ImportPreview> {
  return (await prepare(parseMemoryBundle(doc), options)).preview;
}

async function atomicWrite(file: string, doc: string): Promise<void> {
  await beforeWrite?.(file);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, doc, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
    await fs.chmod(file, 0o600).catch(() => undefined);
  } finally { await fs.unlink(temp).catch(() => undefined); }
}
async function underLocks<T>(locks: string[], action: () => Promise<T>, at = 0): Promise<T> {
  return at === locks.length ? action() : withDocumentLock(locks[at]!, () => underLocks(locks, action, at + 1));
}
async function revert(files: FileChange[]): Promise<void> {
  // Validate every file first; do not overwrite changes made after import.
  for (const file of files) {
    const current = await readDocument(file.path);
    if (current !== file.before && current !== file.after) fail(`cannot roll back a subsequently changed file: ${file.path}`);
  }
  for (const file of files.slice().reverse()) {
    if (await readDocument(file.path) === file.before) continue;
    if (file.before === null) await fs.unlink(file.path);
    else await atomicWrite(file.path, file.before);
  }
}

export async function applyMemoryImport(source: string, token: string, options: ImportOptions = {}) {
  return applyBundle(() => loadBundle(source), token, options);
}
export async function applyMemoryBundle(doc: string, token: string, options: ImportOptions = {}) {
  return applyBundle(async () => parseMemoryBundle(doc), token, options);
}
async function applyBundle(load: () => Promise<MemoryBundle>, token: string, options: ImportOptions) {
  if (!/^[a-f0-9]{64}$/.test(token)) fail('preview first and provide its previewToken before applying');
  const bundle = await load();
  const initial = await prepare(bundle, options);
  if (initial.preview.previewToken !== token) fail('import preview changed; preview again before applying');
  return underLocks(initial.locks, async () => {
    const plan = await prepare(await load(), options);
    if (plan.locks.join('\n') !== initial.locks.join('\n') || plan.preview.previewToken !== token) fail('memory changed since preview; preview again before applying');
    if (plan.files.length === 0) return { ...plan.preview, applied: true, backupPath: null };
    const backupPath = path.join(path.dirname(locations(options).profile), 'migration-backups', `${Date.now()}-${randomUUID()}.json`);
    const journal: Journal = { format: 'dsh-memory-import-backup', version: 1, createdAt: new Date().toISOString(), status: 'pending', locks: plan.locks, files: plan.files };
    const writeJournal = () => {
      const doc = JSON.stringify(journal, null, 2) + '\n';
      if (Buffer.byteLength(doc, 'utf8') > BUNDLE_MAX_BYTES) fail('import backup exceeds 16 MiB; split the migration');
      return atomicWrite(backupPath, doc);
    };
    // Complete durable backup before touching any live memory file.
    await writeJournal();
    try {
      for (const file of plan.files) {
        if (path.basename(file.path) !== 'MEMORY.md') await recordHistory(file.path, file.before, file.after, 'import');
      }
      for (const file of plan.files) await atomicWrite(file.path, file.after);
      journal.status = 'completed';
      await writeJournal();
      return { ...plan.preview, applied: true, backupPath };
    } catch (error) {
      try { await revert(plan.files); journal.status = 'rolled-back'; }
      catch { journal.status = 'rollback-failed'; }
      await writeJournal().catch(() => undefined);
      fail(`import failed (${journal.status}); backup: ${backupPath}; ${String(error)}`);
    }
  });
}

/** Restore raw pre-import files, guarded against subsequent edits. */
export async function rollbackMemoryImport(backup: string, options: MigrationOptions = {}): Promise<void> {
  const backupPath = path.resolve(backup);
  const loc = locations(options);
  if (!within(path.join(path.dirname(loc.profile), 'migration-backups'), backupPath)) fail('backup must be inside this profile\'s migration-backups directory');
  const doc = await readDocument(backupPath);
  if (doc === null) fail('backup does not exist');
  const raw = record(JSON.parse(doc), 'backup');
  if (raw.format !== 'dsh-memory-import-backup' || raw.version !== 1) fail('unsupported backup format');
  const files = unique(array(raw.files, 'backup files').map(item => {
    const value = record(item, 'backup file');
    const target = string(value.path, 'backup target', 8192);
    if (!path.isAbsolute(target) || path.resolve(target) !== target) fail('backup target must be a normalized absolute path');
    if (pathKey(target) !== pathKey(loc.profile)) {
      const rel = path.relative(loc.base, target).split(path.sep);
      const name = rel[1] ?? '';
      const stem = name.slice(0, -3);
      const checked = normalizeTopic(stem);
      if (rel.length !== 2 || !/^[a-f0-9]{16}$/.test(rel[0] ?? '') || !name.endsWith('.md') ||
          (name !== 'MEMORY.md' && (!checked.ok || checked.topic !== stem))) fail('backup target is outside configured memory files');
    }
    return { path: target, before: value.before === null ? null : string(value.before, 'before'), after: string(value.after, 'after') };
  }), f => pathKey(f.path), 'backup target');
  const locks = [...new Set(files.map(f => pathKey(f.path) === pathKey(loc.profile) ? `${loc.profile}.lock` : path.join(path.dirname(f.path), '.lock')))].sort();
  const journal: Journal = { format: 'dsh-memory-import-backup', version: 1,
    createdAt: timestamp(raw.createdAt, 'backup createdAt', false), status: 'rolled-back', locks, files };
  for (const file of files) if (pathKey(file.path) !== pathKey(loc.profile)) await directoryNames(path.dirname(file.path));
  await underLocks(locks, async () => {
    await revert(files);
    await atomicWrite(backupPath, JSON.stringify(journal, null, 2) + '\n');
  });
}
