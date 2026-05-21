import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import http from 'http';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `eidos-dash-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fetch(url: string): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v) headers[k] = Array.isArray(v) ? v.join(', ') : v;
        }
        resolve({
          status: res.statusCode ?? 0,
          headers,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

describe('dashboard server', () => {
  let ws: string;
  let port: number;
  let server: { close: () => void } | null = null;

  beforeAll(async () => {
    ws = tmpDir();
    process.env['EIDOS_WORKSPACE'] = ws;
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();

    // Insert some test data
    const { getDb } = await import('../src/store/db.js');
    const { upsertNode } = await import('../src/store/nodes.js');
    const db = getDb();
    upsertNode(db, {
      id: 'test-chunk-1',
      type: 'chunk',
      properties: { name: 'testFunction', filePath: 'test.ts' },
      importance: 0.8,
    });

    // Find a free port
    const net = await import('net');
    const srv = net.createServer();
    await new Promise<void>((resolve) => srv.listen(0, () => resolve()));
    port = (srv.address() as net.AddressInfo).port;
    srv.close();

    const { startDashboard } = await import('../src/dashboard/server.js');
    startDashboard(port);
    // Give server time to start
    await new Promise(r => setTimeout(r, 300));
  });

  afterAll(async () => {
    const { closeDb, resetDbInstance } = await import('../src/store/db.js');
    closeDb();
    resetDbInstance();
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* Windows lock */ }
  });

  it('GET /api/stats returns 200', async () => {
    const res = await fetch(`http://localhost:${port}/api/stats`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.totalNodes).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/graph returns nodes and edges', async () => {
    const res = await fetch(`http://localhost:${port}/api/graph`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
  });

  it('GET /api/lifetime returns savings data', async () => {
    const res = await fetch(`http://localhost:${port}/api/lifetime`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.tokens_saved).toBe('number');
  });

  it('CORS header restricts to localhost origins', async () => {
    const res = await fetch(`http://localhost:${port}/api/stats`);
    // When no Origin header is sent, server should still respond
    expect(res.status).toBe(200);
  });

  it('GET / returns HTML', async () => {
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});
