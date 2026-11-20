// 本地测试用静态服务器（交付物本身不需要它，file:// 直接双击即可）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const port = process.env.PORT || 8765;
createServer(async (req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  try {
    const f = path.join(root, p === '/' ? '高性价比人生指南工作台.html' : p);
    if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
    const buf = await readFile(f);
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(404).end('404'); }
}).listen(port, () => console.log('listening', port));
