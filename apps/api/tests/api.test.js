import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { createServer } = await import('../server.js');

function startServer() {
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

test('GET /signals/current returns normalized mock payload', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current`);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.symbol, 'SPX');
    assert.equal(json.is_mock, true);
    assert.ok(Array.isArray(json.source_status));
    assert.ok(json.source_status.every((item) => item.is_mock === true));
  } finally {
    server.close();
  }
});

test('required endpoints respond without crashing when unconfigured', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const urls = [
      '/health',
      '/sources/status',
      '/gamma/summary',
      '/events',
      '/logs/recent'
    ];

    for (const url of urls) {
      const response = await fetch(`${baseUrl}${url}`);
      assert.equal(response.ok, true, `Expected ${url} to be ok`);
    }
  } finally {
    server.close();
  }
});
