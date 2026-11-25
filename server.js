import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApi } from './backend/app.js';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/resultado', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

export function createApp(options = {}) {
  const api = createApi(options);
  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/')) return api(req, res);
    const file = files.get(path);
    if (!file || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404); return res.end('No encontrado');
    }
    try {
      const content = await readFile(resolve(publicDir, file[0]));
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(500); res.end('No se pudo cargar la aplicación.'); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '0.0.0.0', () => console.log(`Aplicación: http://localhost:${port}`));
}
