import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRoute } from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '../web');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const filePath = pathname === '/styles.css' || pathname === '/app.js'
    ? path.join(webRoot, pathname.slice(1))
    : path.join(webRoot, 'index.html');

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[ext] ?? 'text/html; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found', is_mock: true }));
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const handled = await handleApiRoute(req, res);
    if (handled !== false) {
      return;
    }
    return serveStatic(req, res);
  });
}

const shouldListen = process.env.NODE_ENV !== 'test';

if (shouldListen) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => {
    console.log(`spx-ops-dashboard skeleton listening on http://localhost:${port}`);
  });
}
