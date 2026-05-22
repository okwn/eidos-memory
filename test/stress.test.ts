import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `eidos-stress-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Stress / Performance Tests ──────────────────────────────────────────────

describe('stress: bulk node insertion', () => {
  let ws: string;

  beforeAll(async () => {
    ws = tmpDir();
    process.env['EIDOS_WORKSPACE'] = ws;
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
  });

  afterAll(async () => {
    const { closeDb, resetDbInstance } = await import('../src/store/db.js');
    closeDb();
    resetDbInstance();
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* Windows lock */ }
  });

  it('inserts 500 nodes efficiently', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { upsertNode } = await import('../src/store/nodes.js');
    const db = getDb();

    const start = Date.now();
    for (let i = 0; i < 500; i++) {
      upsertNode(db, {
        id: `stress:node:${i}`,
        type: 'chunk',
        properties: { name: `func_${i}`, filePath: `src/file_${i % 50}.ts` },
        importance: Math.random(),
      });
    }
    const elapsed = Date.now() - start;

    const count = db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number };
    expect(count.c).toBeGreaterThanOrEqual(500);
    // CI runners can be slow — use generous threshold
    expect(elapsed).toBeLessThan(process.env.CI ? 30000 : 5000);
  });

  it('retrieves nodes efficiently after bulk insert', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { listNodes } = await import('../src/store/nodes.js');
    const db = getDb();

    const start = Date.now();
    const nodes = listNodes(db, 'chunk', 100);
    const elapsed = Date.now() - start;

    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.length).toBeLessThanOrEqual(100);
    // Should retrieve in under 100ms
    expect(elapsed).toBeLessThan(100);
  });
});

describe('stress: edge insertion', () => {
  let ws: string;

  beforeAll(async () => {
    ws = tmpDir();
    process.env['EIDOS_WORKSPACE'] = ws;
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
  });

  afterAll(async () => {
    const { closeDb, resetDbInstance } = await import('../src/store/db.js');
    closeDb();
    resetDbInstance();
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* Windows lock */ }
  });

  it('inserts 500 edges efficiently', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { upsertNode } = await import('../src/store/nodes.js');
    const { upsertEdge } = await import('../src/store/edges.js');
    const db = getDb();

    // Create source and target nodes
    for (let i = 0; i < 50; i++) {
      upsertNode(db, { id: `src:${i}`, type: 'file', properties: {}, importance: 0.5 });
      upsertNode(db, { id: `tgt:${i}`, type: 'chunk', properties: {}, importance: 0.5 });
    }

    const start = Date.now();
    let edgeCount = 0;
    for (let i = 0; i < 50; i++) {
      for (let j = 0; j < 10; j++) {
        upsertEdge(db, {
          id: `edge:${i}:${j}`,
          source_id: `src:${i}`,
          target_id: `tgt:${j}`,
          rel_type: 'CONTAINS',
          weight: 1.0,
        });
        edgeCount++;
      }
    }
    const elapsed = Date.now() - start;

    const count = db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number };
    expect(count.c).toBe(edgeCount);
    // CI runners can be slow — use generous threshold
    expect(elapsed).toBeLessThan(process.env.CI ? 30000 : 5000);
  });
});

describe('stress: token counting throughput', () => {
  it('counts tokens for 1000 strings in under 1 second', async () => {
    const { countTokens } = await import('../src/engine/tokens.js');
    const strings = Array.from({ length: 1000 }, (_, i) => `function test${i}() { return ${i}; }`);

    const start = Date.now();
    for (const s of strings) {
      countTokens(s);
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });
});

describe('stress: intent classification throughput', () => {
  it('classifies 50 queries in under 5 seconds', async () => {
    const { classifyIntent } = await import('../src/engine/intent.js');
    const queries = [
      'debug the login bug',
      'implement a REST API',
      'what did we decide about the database?',
      'summarize the session',
      'explain how auth works',
    ];

    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      for (const q of queries) {
        await classifyIntent(q);
      }
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });
});
