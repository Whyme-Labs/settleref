import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.map':'application/json' };

// Export the actual request handler for environments that deny local sockets.
export function createHandler(siteRoot = 'dist') {
  const root = resolve(siteRoot);
  return async (req, res) => {
    try {
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) {
        res.writeHead(400); res.end('Bad path'); return;
      }
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      // Reject ambiguous paths before resolving or constructing a redirect.
      // A second decoding pass must never turn a local Location into //host.
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /%(?:2f|5c)/i.test(url.pathname) || /%[0-9a-f]{2}/i.test(path)) {
        res.writeHead(400); res.end('Bad path'); return;
      }
      const requested = resolve(root, '.' + path);
      if (requested !== root && !requested.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
      const realRoot = await realpath(root);
      const realRequested = await realpath(requested);
      if (realRequested !== realRoot && !realRequested.startsWith(realRoot + sep)) { res.writeHead(403); res.end(); return; }
      const directory = (await stat(requested)).isDirectory();
      if (directory && !path.endsWith('/')) {
        res.writeHead(308, { Location: url.pathname + '/' + url.search, 'Cache-Control':'no-store' });
        res.end(); return;
      }
      const file = directory ? resolve(requested, 'index.html') : requested;
      const realFile = await realpath(file);
      if (!realFile.startsWith(realRoot + sep)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type':types[extname(file)] ?? 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404); res.end('Not found'); }
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 4173);
  http.createServer(createHandler()).listen(port,'127.0.0.1',() => console.log(`SettleRef on http://127.0.0.1:${port}`));
}
