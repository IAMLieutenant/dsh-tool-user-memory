import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { createMemoryManager, type ManagerOptions } from './manager.ts';
import { MANAGER_HTML } from './manager-ui.ts';
import { managerError } from './manager-errors.ts';

export const MANAGER_ROUTE = '/_dsh/user-memory';
const BODY_LIMIT = 34 * 1024 * 1024;
type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
function localRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress;
  if (!remote || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
  let url: URL;
  try { url = new URL(`http://${req.headers.host}`); } catch { return false; }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== url.host) return false; } catch { return false; }
  }
  return true;
}
function send(res: ServerResponse, code: number, body: unknown, html = false, nonce = ''): void {
  res.writeHead(code, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': html ? `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'` : "default-src 'none'; frame-ancestors 'none'" });
  res.end(html ? body as string : JSON.stringify(body));
}
export function managerHandlers(options: ManagerOptions = {}): { page: Handler; api: Handler; automatic: Handler } {
  const manager = createMemoryManager(options);
  const token = randomBytes(32).toString('hex');
  const nonce = randomBytes(20).toString('hex');
  return {
    async automatic(req, res) {
      if (!localRequest(req)) { send(res, 403, { ok: false, error: '仅允许本机同源访问' }); return; }
      try {
        if (req.method === 'GET') {
          const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
          const items = await manager.action({ action: 'automatic-notices', sessionId: params.get('session') ?? '', turn: Number(params.get('turn')) });
          send(res, 200, { ok: true, items, token }); return;
        }
        if (req.method !== 'POST') { send(res, 405, { ok: false }); return; }
        if (req.headers['x-user-memory-token'] !== token || String(req.headers['content-type']).split(';')[0] !== 'application/json') { send(res, 403, { ok: false }); return; }
        let body = ''; for await (const part of req) { body += part.toString(); if (Buffer.byteLength(body) > 4096) throw new Error('请求过大'); }
        const input = JSON.parse(body), result = await manager.action({ action: 'undo-automatic', key: input.key, id: input.id });
        send(res, 200, { ok: true, result });
      } catch (e) { send(res, 400, { ok: false, error: (e as Error).message }); }
    },
    async page(req, res) {
      if (!localRequest(req)) { send(res, 403, { ok: false, error: '管理页仅允许本机同源访问' }); return; }
      if (req.method !== 'GET') { send(res, 405, { ok: false, error: '需要 GET' }); return; }
      const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
      const embedded = params.get('embedded') === '1';
      const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
      send(res, 200, MANAGER_HTML.replaceAll('__NONCE__', nonce).replace('__TOKEN__', token)
        .replace('__BODY_CLASS__', embedded ? 'embedded' : '').replace('__THEME__', theme), true, nonce);
    },
    async api(req, res) {
      if (!localRequest(req) || req.headers['x-user-memory-token'] !== token) { send(res, 403, { ok: false, error: '访问验证失败，请重新打开管理页' }); return; }
      if (req.method !== 'POST') { send(res, 405, { ok: false, error: '需要 POST' }); return; }
      if (String(req.headers['content-type']).split(';')[0] !== 'application/json') { send(res, 415, { ok: false, error: '需要 JSON 请求' }); return; }
      let action = '';
      try {
        let bytes = 0; const chunks: Buffer[] = [];
        for await (const part of req) { const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part); bytes += chunk.length;
          if (bytes > BODY_LIMIT) throw new Error('请求超过容量限制'); chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof input?.action === 'string') action = input.action;
        const result = await manager.action(input);
        send(res, 200, { ok: true, result });
      } catch (error) { const shown = managerError(error, action); send(res, 400, { ok: false, error: shown.message, code: shown.code }); }
    },
  };
}
export function installManagerWeb(ctx: Context, options: ManagerOptions): void {
  ctx.inject(['webServer'], child => {
    const web = child.get('webServer') as { register(route: { kind: 'exact'; path: string; handler: Handler }): () => void };
    const handlers = managerHandlers(options);
    child.effect(() => web.register({ kind: 'exact', path: MANAGER_ROUTE, handler: handlers.page }));
    child.effect(() => web.register({ kind: 'exact', path: `${MANAGER_ROUTE}/api`, handler: handlers.api }));
    child.effect(() => web.register({ kind: 'exact', path: `${MANAGER_ROUTE}/automatic`, handler: handlers.automatic }));
  });
}
export async function startManagerServer(options: ManagerOptions = {}, port = 0) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口无效');
  const handlers = managerHandlers(options);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const handler = url.pathname === MANAGER_ROUTE ? handlers.page : url.pathname === `${MANAGER_ROUTE}/api` ? handlers.api : url.pathname === `${MANAGER_ROUTE}/automatic` ? handlers.automatic : null;
    if (!handler) { send(res, 404, { ok: false, error: '页面不存在' }); return; }
    void handler(req, res).catch(() => { if (!res.headersSent) send(res, 500, { ok: false, error: '请求失败' }); else res.end(); });
  });
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('管理页启动失败');
  return { server, url: `http://127.0.0.1:${address.port}${MANAGER_ROUTE}` };
}
