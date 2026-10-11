import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { runInNewContext } from 'node:vm';
import { request } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import { createMemoryStore } from '../src/store.ts';
import { createMemoryManager } from '../src/manager.ts';
import { startManagerServer, installManagerWeb, MANAGER_ROUTE } from '../src/manager-web.ts';
import { documentHash, listArchives, listHistory, restoreHistory, HISTORY_LIMIT } from '../src/history.ts';
import { createWorkspaceMemory, projectDirectory, workspaceHashOf } from '../src/workspace.ts';
import { previewMemoryBundle, exportMemoryBundle } from '../src/migration.ts';
import { memoryPromptPreview } from '../src/prompt.ts';
import { managerError } from '../src/manager-errors.ts';

async function fixture(maxBytes = 8192) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-manager-'));
  const profilePath = join(dir, 'user.md'); const workspaceBase = join(dir, 'workspaces');
  const options = { profilePath, workspaceBase, maxBytes };
  return { dir, options, store: createMemoryStore({ path: profilePath, maxBytes }), manager: createMemoryManager(options), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('history: overwrite, deletion, restoring absence and undoing a restore are recoverable', async () => {
  const f = await fixture();
  try {
    await f.store.update('language', '中文', 'set');
    await f.store.update('language', 'English', 'set');
    let h = await listHistory(f.options.profilePath);
    const old = h.find(x => x.before?.includes('中文'))!;
    await restoreHistory(f.options.profilePath, old.id, documentHash(await f.store.read()), `${f.options.profilePath}.lock`, 8192);
    assert.equal((await f.store.list())[0]!.value, '中文');
    h = await listHistory(f.options.profilePath);
    assert.ok(h.some(x => x.label === 'restore' && x.before?.includes('English')));
    await f.store.update('language', '', 'remove');
    assert.equal((await f.store.list()).length, 0);
    assert.ok((await listHistory(f.options.profilePath)).some(x => x.before?.includes('中文')));
    const first = (await listHistory(f.options.profilePath)).find(x => x.before === null)!;
    await restoreHistory(f.options.profilePath, first.id, documentHash(await f.store.read()), `${f.options.profilePath}.lock`, 8192);
    assert.equal(await f.store.read(), '');
  } finally { await f.cleanup(); }
});

test('history: rejects stale confirmation and enforces retention', async () => {
  const f = await fixture();
  try {
    await f.store.update('a', 'one', 'set');
    const revision = documentHash(await f.store.read());
    await f.store.update('a', 'two', 'set');
    const h = await listHistory(f.options.profilePath);
    await assert.rejects(restoreHistory(f.options.profilePath, h[0]!.id, revision, `${f.options.profilePath}.lock`, 8192), /变化/);
    for (let i = 0; i < 25; i++) await f.store.update('a', String(i), 'set');
    assert.equal((await listHistory(f.options.profilePath)).length, HISTORY_LIMIT);
  } finally { await f.cleanup(); }
});

test('archive: retains complete evicted and truncated entries and allows confirmed restoration', async () => {
  const f = await fixture(350);
  try {
    await f.store.update('old', 'x'.repeat(120), 'set');
    await f.store.update('new', 'y'.repeat(120), 'set');
    const result = await f.store.update('huge', 'z'.repeat(1000), 'set');
    assert.equal(result.truncated, 'huge'); assert.ok(result.archivePath);
    const archives = await listArchives(f.options.profilePath);
    assert.ok(archives.some(a => a.entries.some(e => e.key === 'old' && e.value.length === 120)));
    assert.ok(archives.some(a => a.entries.some(e => e.key === 'huge' && e.value.length === 1000)));
    const bigger = createMemoryManager({ ...f.options, maxBytes: 4000 });
    const chosen = archives.find(a => a.entries.some(e => e.key === 'huge'))!;
    const state = await bigger.snapshot();
    await bigger.action({ action: 'restore-archive', id: chosen.id, key: 'huge', replace: true, revision: state.revision });
    assert.equal((await f.store.list()).find(e => e.key === 'huge')!.value.length, 1000);
  } finally { await f.cleanup(); }
});

test('manager: stale editing and duplicate create cannot overwrite current memory', async () => {
  const f = await fixture();
  try {
    await f.store.update('a', 'one', 'set');
    const s = await f.manager.snapshot();
    await f.store.update('a', 'two', 'set');
    await assert.rejects(f.manager.action({ action: 'update', scope: 'global', key: 'a', value: 'old browser', mode: 'set', revision: s.revision }), /变化/);
    const fresh = await f.manager.snapshot();
    await assert.rejects(f.manager.action({ action: 'update', scope: 'global', key: 'a', value: 'overwrite', mode: 'set', revision: fresh.revision, createOnly: true }), /同名/);
    assert.equal((await f.store.list())[0]!.value, 'two');
  } finally { await f.cleanup(); }
});

test('manager: guarded deletion removes active global and project memory and keeps recovery snapshots', async () => {
  const f = await fixture();
  try {
    await f.store.update('delete-me', 'private preference', 'set');
    const state = await f.manager.snapshot();
    await f.manager.action({ action: 'update', scope: 'global', key: 'delete-me', value: '', mode: 'remove', revision: state.entries[0]!.revision });
    assert.equal((await f.manager.snapshot()).entries.length, 0);
    assert.ok(!memoryPromptPreview(f.store, undefined, 2048, 0, 512, f.options.workspaceBase).includes('private preference'));
    assert.ok((await listHistory(f.options.profilePath)).some(h => h.before?.includes('private preference')));
    const ws = await createWorkspaceMemory({ cwd: f.dir, baseDir: f.options.workspaceBase });
    await ws.write('topic', 'keep newer content', 'set');
    const id = basename(ws.dir), stale = (await f.manager.snapshot(id)).entries[0]!.revision;
    await ws.write('topic', 'new edit', 'set');
    await assert.rejects(f.manager.action({ action: 'update', scope: 'workspace', projectId: id, key: 'topic', value: '', mode: 'remove', revision: stale }), /变化/);
    assert.equal((await ws.read('topic'))!.body, 'new edit');
    const revision = (await f.manager.snapshot(id)).entries[0]!.revision;
    await f.manager.action({ action: 'update', scope: 'workspace', projectId: id, key: 'topic', value: '', mode: 'remove', revision });
    assert.equal((await ws.list()).length, 0);
    assert.ok(!(await ws.indexText()).includes('topic'));
    assert.ok((await listHistory(join(ws.dir, 'topic.md'))).some(h => h.before?.includes('new edit')));
  } finally { await f.cleanup(); }
});

test('manager errors: actionable messages preserve import recovery details', () => {
  assert.equal(managerError(new Error('write failed: 置顶记忆超过容量')).code, 'PINNED_CAPACITY');
  assert.match(managerError(Object.assign(new Error('missing'), { code: 'ENOENT' }), 'preview-import').message, /本机已存在/);
  assert.equal(managerError(new Error('merged profile exceeds 10 bytes; nothing was imported'), 'preview-import').code, 'IMPORT_CAPACITY');
  assert.match(managerError(new Error('merged profile exceeds 10 bytes'), 'preview-import').message, /本次未导入/);
  assert.equal(managerError(new Error('memory changed since preview; preview again before applying'), 'apply-import').code, 'PREVIEW_CHANGED');
  assert.match(managerError(new Error('cannot roll back a subsequently changed file: x'), 'rollback-import').message, /不会覆盖/);
  const failure = 'import failed (rollback-failed); backup: C:/backup.json; ENOSPC';
  assert.ok(managerError(new Error(failure), 'apply-import').message.endsWith(failure));
  assert.equal(managerError(new SyntaxError('invalid JSON'), 'inspect-import').code, 'INVALID_BUNDLE');
});

test('pin manager: priority-only changes preserve dates and invalidation, guard concurrent edits, and restore from history', async () => {
  const f = await fixture();
  try {
    await f.store.update('a', 'one', 'set');
    await f.store.update('a', '', 'invalidate', 'old');
    const before = (await f.manager.snapshot()).entries[0]!;
    await f.manager.action({ action: 'set-pinned', scope: 'global', key: 'a', pinned: true, revision: before.revision });
    const pinned = (await f.manager.snapshot()).entries[0]!;
    assert.equal(pinned.pinned, true); assert.equal(pinned.updatedAt, before.updatedAt); assert.equal(pinned.invalidatedAt, before.invalidatedAt);
    assert.ok(!memoryPromptPreview(f.store, undefined).includes('## a'));
    await assert.rejects(f.manager.action({ action: 'set-pinned', scope: 'global', key: 'a', pinned: false, revision: before.revision }), /changed/);
    const h = await f.manager.action({ action: 'history', scope: 'global', key: 'a' }) as { revision: string; records: { id: string }[] };
    await f.manager.action({ action: 'restore-history', scope: 'global', key: 'a', id: h.records[0]!.id, revision: h.revision });
    assert.equal((await f.store.list())[0]!.pinned, undefined);
    const state = await f.manager.snapshot();
    await f.manager.action({ action: 'update', scope: 'global', key: 'a', value: 'two', mode: 'set', pinned: true, revision: state.revision });
    const staleEntry = (await f.store.list())[0]!;
    await f.store.setPinned('a', false);
    const staleRewrite = await f.store.rewrite('a', 'stale', { expected: staleEntry });
    assert.equal(staleRewrite.ok, false); assert.equal((await f.store.list())[0]!.value, 'two');
  } finally { await f.cleanup(); }
});

test('pin persistence: capacity rejection changes no memory, archive or history; unpin permits normal eviction', async () => {
  const f = await fixture(350);
  try {
    await f.store.update('important', 'x'.repeat(100), 'set', '', undefined, true);
    const original = (await f.store.list())[0]!;
    const pressure = await f.store.update('new', 'y'.repeat(200), 'set');
    assert.equal(pressure.ok, true); assert.deepEqual(pressure.evicted, ['new']);
    assert.deepEqual((await f.store.list()).find(e => e.key === 'important'), original);
    const before = await f.store.read(), h = await listHistory(f.options.profilePath), a = await listArchives(f.options.profilePath);
    const rejected = await f.store.update('important', 'z'.repeat(1000), 'set');
    assert.equal(rejected.ok, false); assert.match(rejected.error!, /置顶记忆/);
    assert.equal(await f.store.read(), before); assert.deepEqual(await listHistory(f.options.profilePath), h); assert.deepEqual(await listArchives(f.options.profilePath), a);
    await f.store.setPinned('important', false);
    const unpinned = (await f.store.list())[0]!;
    assert.equal(unpinned.updatedAt, original.updatedAt); assert.equal(unpinned.pinned, undefined);
    await f.store.update('new', 'y'.repeat(120), 'set');
    assert.ok(!(await f.store.list()).some(e => e.key === 'important'));
  } finally { await f.cleanup(); }
});

test('pin migration: old exports remain readable, pins round trip, keep-local respects pin conflicts, rollback preserves pins', async () => {
  const old = await fixture(), fresh = await fixture();
  try {
    await old.store.update('a', 'one', 'set', '', undefined, true);
    const bundle = await exportMemoryBundle(old.options);
    assert.equal(bundle.profile[0]!.pinned, true);
    const doc = JSON.stringify(bundle), options = { includeProfile: true, policy: 'keep-local', projectMap: [] };
    const p = await fresh.manager.action({ action: 'preview-import', doc, options }) as { previewToken: string };
    const applied = await fresh.manager.action({ action: 'apply-import', doc, options, previewToken: p.previewToken }) as { backupPath: string };
    assert.deepEqual((await exportMemoryBundle(fresh.options)).profile, bundle.profile);
    const legacy = structuredClone(bundle); delete legacy.profile[0]!.pinned;
    const preview = await fresh.manager.action({ action: 'preview-import', doc: JSON.stringify(legacy), options }) as { profile: { kept: number }; filesToWrite: number };
    assert.equal(preview.profile.kept, 1); assert.equal(preview.filesToWrite, 0);
    const replaceOptions = { ...options, policy: 'use-imported' };
    const replacePreview = await fresh.manager.action({ action: 'preview-import', doc: JSON.stringify(legacy), options: replaceOptions }) as { previewToken: string };
    const replaced = await fresh.manager.action({ action: 'apply-import', doc: JSON.stringify(legacy), options: replaceOptions, previewToken: replacePreview.previewToken }) as { backupPath: string };
    assert.equal((await fresh.store.list())[0]!.pinned, undefined);
    await fresh.manager.action({ action: 'rollback-import', backupPath: replaced.backupPath });
    assert.deepEqual((await exportMemoryBundle(fresh.options)).profile, bundle.profile);
    const bad = structuredClone(bundle) as unknown as { profile: { pinned: unknown }[] }; bad.profile[0]!.pinned = 'yes';
    await assert.rejects(fresh.manager.action({ action: 'inspect-import', doc: JSON.stringify(bad) }), /boolean/);
    await fresh.manager.action({ action: 'rollback-import', backupPath: applied.backupPath });
    assert.equal((await fresh.store.list()).length, 0);
    const unpinnedBundle = await fresh.manager.action({ action: 'inspect-import', doc: JSON.stringify(legacy) }) as { profileEntries: number };
    assert.equal(unpinnedBundle.profileEntries, 1);
  } finally { await old.cleanup(); await fresh.cleanup(); }
});

test('manager: restoring a removed project topic rebuilds its index, including an otherwise empty project', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspaceMemory({ cwd: f.dir, baseDir: f.options.workspaceBase });
    await ws.write('build', 'pnpm test', 'set');
    await ws.write('build', '', 'remove');
    const state = await f.manager.snapshot(basename(ws.dir));
    assert.equal(state.entries.length, 0); assert.equal(state.projects.length, 1);
    const history = await f.manager.action({ action: 'history', scope: 'workspace', projectId: basename(ws.dir), key: 'build' }) as { records: { id: string; before: string | null }[]; revision: string };
    await f.manager.action({ action: 'restore-history', scope: 'workspace', projectId: basename(ws.dir), key: 'build', id: history.records.find(x => x.before?.includes('pnpm test'))!.id, revision: history.revision });
    assert.equal((await ws.read('build'))!.body, 'pnpm test');
    assert.ok((await ws.indexText()).includes('build'));
  } finally { await f.cleanup(); }
});

test('identity: Git root mode shares nested sessions while directory mode and explicit overrides remain available', async () => {
  const f = await fixture();
  try {
    const nested = join(f.dir, 'src', 'app'); await mkdir(nested, { recursive: true }); await writeFile(join(f.dir, '.git'), 'gitdir: somewhere');
    const root = await createWorkspaceMemory({ cwd: f.dir, baseDir: f.options.workspaceBase, mode: 'git-root' });
    await root.write('build', 'pnpm build', 'set');
    const child = await createWorkspaceMemory({ cwd: nested, baseDir: f.options.workspaceBase, mode: 'git-root' });
    assert.equal(child.dir, root.dir); assert.equal((await child.read('build'))!.body, 'pnpm build');
    const separate = await createWorkspaceMemory({ cwd: nested, baseDir: f.options.workspaceBase }); assert.notEqual(separate.dir, root.dir);
    assert.equal(projectDirectory(nested, 'directory', f.dir), root.path);
    const explicit = createMemoryManager({ ...f.options, projectPath: f.dir });
    assert.equal((await explicit.diagnose()).workspace && (await explicit.diagnose()).workspaceError, '');
    assert.ok(memoryPromptPreview(f.store, undefined, 2048, 0, 512, f.options.workspaceBase, 'directory', f.dir).includes('Current workspace memory index'));
    const exported = await exportMemoryBundle(f.options);
    const preview = await previewMemoryBundle(JSON.stringify(exported), { ...f.options, workspaceMode: 'git-root', projectMap: [{ id: basename(root.dir), path: nested }] });
    assert.equal(preview.projects[0]!.targetPath, root.path);
  } finally { await f.cleanup(); }
});

test('identity: Windows casing is folded, Linux casing remains distinct', () => {
  assert.equal(workspaceHashOf('C:\\Work\\App', 'win32'), workspaceHashOf('c:\\work\\app', 'win32'));
  assert.notEqual(workspaceHashOf('/work/App', 'linux'), workspaceHashOf('/work/app', 'linux'));
});

test('manager: import wizard previews, rejects a changed destination, applies and rolls back', async () => {
  const old = await fixture(); const fresh = await fixture();
  try {
    await old.store.update('a', 'imported', 'set');
    const doc = JSON.stringify(await exportMemoryBundle(old.options));
    const options = { includeProfile: true, projectMap: [], policy: 'keep-local' };
    let preview = await fresh.manager.action({ action: 'preview-import', doc, options }) as { previewToken: string };
    assert.equal((await fresh.store.list()).length, 0);
    await fresh.store.update('b', 'local', 'set');
    await assert.rejects(fresh.manager.action({ action: 'apply-import', doc, options, previewToken: preview.previewToken }), /changed/);
    preview = await fresh.manager.action({ action: 'preview-import', doc, options }) as { previewToken: string };
    const result = await fresh.manager.action({ action: 'apply-import', doc, options, previewToken: preview.previewToken }) as { backupPath: string };
    assert.equal((await fresh.store.list()).length, 2);
    assert.ok((await listHistory(fresh.options.profilePath)).some(h => h.label === 'import'));
    await fresh.manager.action({ action: 'rollback-import', backupPath: result.backupPath });
    assert.deepEqual((await fresh.store.list()).map(e => e.key), ['b']);
  } finally { await old.cleanup(); await fresh.cleanup(); }
});

test('web: local page works, API rejects foreign origins, missing token, wrong methods and hostile Host', async () => {
  const f = await fixture(); const { server, url } = await startManagerServer(f.options);
  try {
    const page = await fetch(url); assert.equal(page.status, 200);
    assert.ok(page.headers.get('content-security-policy')!.includes('nonce-'));
    const html = await page.text(); const token = /TOKEN='([a-f0-9]+)'/.exec(html)![1]!;
    assert.ok(html.includes('data-tab="overview"')); assert.ok(!html.includes('__TOKEN__'));
    const embedded = await fetch(url + '?embedded=1');
    assert.ok((await embedded.text()).includes('body class="embedded"'));
    assert.ok(embedded.headers.get('content-security-policy')!.includes("frame-ancestors 'self'"));
    assert.ok((await (await fetch(url + '?embedded=1&theme=dark')).text()).includes('data-theme="dark"'));
    const endpoint = `${url}/api`;
    assert.equal((await fetch(endpoint)).status, 403);
    const headers = { 'Content-Type': 'application/json', 'X-User-Memory-Token': token };
    assert.equal((await fetch(endpoint, { headers })).status, 405);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{"action":"snapshot"}' })).status, 403);
    const hostile = await new Promise<number | undefined>((resolve, reject) => {
      request(url, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject).end();
    });
    assert.equal(hostile, 403);
    const good = await fetch(endpoint, { method: 'POST', headers, body: '{"action":"snapshot"}' }); assert.equal(good.status, 200);
    assert.equal((await good.json()).ok, true);
    assert.equal((await fetch(endpoint, { method: 'POST', headers, body: 'invalid JSON' })).status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.cleanup(); }
});

test('web: optional Cordis web routes mount and unregister with their plugin', async () => {
  const f = await fixture(); const ctx = new Context(); const paths = new Set<string>();
  try {
    ctx.provide('webServer', { register(route: { path: string }) { paths.add(route.path); return () => { paths.delete(route.path); }; } });
    const fiber = await ctx.plugin({ name: 'test-memory-web', apply(child: Context) { installManagerWeb(child, f.options); } });
    assert.ok(paths.has(MANAGER_ROUTE)); assert.ok(paths.has(`${MANAGER_ROUTE}/api`));
    await fiber.dispose(); assert.equal(paths.size, 0);
  } finally { await ctx.fiber.dispose(); await f.cleanup(); }
});

test('client: plugin-row button opens one in-window dialog, closes and cleans up on unload', async () => {
  let entry: { factory: (require: (name: string) => unknown) => { apply: (ctx: unknown) => void } } | undefined;
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  type Element = { tag: string; props?: Record<string, unknown>; children: Element[]; style: object; open?: boolean; removed?: boolean; src?: string; textContent?: string; append(...children: Element[]): void; setAttribute(key: string, value: string): void; addEventListener(key: string, value: () => void): void; showModal(): void; close(): void; remove(): void; focus(): void; events: Record<string, () => void> };
  const elements: Element[] = [];
  function element(tag: string): Element {
    const e: Element = { tag, children: [], style: {}, events: {},
      append(...children) { this.children.push(...children); },
      setAttribute() {}, addEventListener(key, value) { this.events[key] = value; },
      showModal() { this.open = true; }, close() { this.open = false; this.events.close?.(); },
      remove() { this.removed = true; }, focus() {} };
    elements.push(e); return e;
  }
  let dark = true; let disconnected = false; let themeChanged: (() => void) | undefined;
  const root = { dataset: { theme: '' }, style: { values: {} as Record<string, string>, setProperty(key: string, value: string) { this.values[key] = value; } } };
  const body = { ...element('body'), hasAttribute(name: string) { assert.equal(name, 'data-ds-dark-theme'); return dark; } };
  function createElement(tag: string) { const e = element(tag); if (tag === 'iframe') Object.assign(e, { contentDocument: { documentElement: root } }); return e; }
  runInNewContext(source, { document: { body, head: element('head'), documentElement: element('html'), createElement, activeElement: null },
    MutationObserver: class { constructor(callback: () => void) { themeChanged = callback; } observe() {} disconnect() { disconnected = true; } },
    getComputedStyle() { return { fontFamily: 'DSH Test Font', getPropertyValue() { return dark ? '#212123' : '#fff'; } }; },
    window: { __ModuleLoader__: { load(e: typeof entry) { entry = e; } } } });
  assert.ok(entry); let registered = ''; let card: (() => Element) | undefined;
  const disposers: (() => void)[] = [];
  const plugin = entry!.factory(name => { assert.equal(name, 'react'); return {
    createElement(tag: string, props: Record<string, unknown>, ...children: Element[]) { return { tag, props, children }; } }; });
  plugin.apply({ effect(f: () => (() => void) | undefined) { const dispose = f(); if (dispose) disposers.push(dispose); },
    slots: { inject(name: string, f: () => unknown) { assert.equal(name, 'plugins.row.config'); return f(); },
      register(meta: { key: string }, component: () => Element) { registered = meta.key; card = component; return () => {}; } } });
  assert.equal(registered, 'dsh-tool-user-memory#tool-user-memory');
  const button = card!().children[0]!;
  assert.equal(button.tag, 'button'); assert.equal(button.props!.target, undefined);
  const open = button.props!.onClick as () => void;
  open(); open();
  assert.equal(elements.filter(e => e.tag === 'dialog').length, 1);
  const frame = elements.find(e => e.tag === 'iframe')!;
  assert.equal(frame.src, '/_dsh/user-memory?embedded=1&theme=dark');
  frame.events.load!();
  assert.equal(root.dataset.theme, 'dark'); assert.equal(root.style.values['--memory-bg'], '#212123');
  dark = false; themeChanged!();
  assert.equal(root.dataset.theme, 'light'); assert.equal(root.style.values['--memory-bg'], '#fff');
  const modal = elements.find(e => e.tag === 'dialog')!;
  assert.equal(modal.open, true);
  elements.find(e => e.tag === 'button')!.events.click!();
  assert.equal(modal.open, false); assert.equal(modal.removed, true);
  assert.equal(disconnected, true);
  open(); const reopened = elements.filter(e => e.tag === 'dialog')[1]!;
  for (const dispose of disposers.reverse()) dispose();
  assert.equal(reopened.open, false); assert.equal(reopened.removed, true);
});
