import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;
const scenariosDir = path.join(root, 'mock-data', 'scenarios');
const defaultScenario = 'negative_gamma_wait_pullback';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

async function readScenario(scenario) {
  const safeScenario = scenario || defaultScenario;
  const filePath = path.join(scenariosDir, `${safeScenario}.json`);
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return await fs.readFile(path.join(scenariosDir, `${defaultScenario}.json`), 'utf8');
  }
}

async function serveStatic(pathname, res) {
  const filePath = pathname === '/app.js' || pathname === '/styles.css'
    ? path.join(root, pathname.slice(1))
    : path.join(root, 'index.html');

  const content = await fs.readFile(filePath);
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/html; charset=utf-8' });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/signals/current') {
    const body = await readScenario(url.searchParams.get('scenario'));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/radar' || url.pathname === '/app.js' || url.pathname === '/styles.css')) {
    await serveStatic(url.pathname, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`spx ui source package listening on http://localhost:${port}`);
});
