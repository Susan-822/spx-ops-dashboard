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

const BASIC_AUTH_USER = process.env.APP_BASIC_AUTH_USER || 'spx';
const BASIC_AUTH_PASSWORD = process.env.APP_BASIC_AUTH_PASSWORD || '';

function isAuthExempt(pathname) {
  return pathname === '/health' || pathname === '/webhook/tradingview' || pathname === '/ingest/uw';
}

function parseBasicAuth(authorizationHeader) {
  if (!authorizationHeader || !authorizationHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const decoded = Buffer.from(authorizationHeader.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

function isAuthorized(req) {
  if (!BASIC_AUTH_PASSWORD) {
    return true;
  }

  const credentials = parseBasicAuth(req.headers.authorization);
  if (!credentials) {
    return false;
  }

  return credentials.username === BASIC_AUTH_USER && credentials.password === BASIC_AUTH_PASSWORD;
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="SPX Ops Dashboard"'
  });
  res.end('Authentication required.');
}

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
    const url = new URL(req.url, 'http://localhost');
    if (!isAuthExempt(url.pathname) && !isAuthorized(req)) {
      return sendUnauthorized(res);
    }

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
