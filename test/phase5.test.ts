import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `eidos-p5-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── CRDT — LWW merge ──────────────────────────────────────────────────────────

describe('CRDT LWW node merge', () => {
  it('remote wins when its timestamp is higher', async () => {
    const { mergeLwwNodes } = await import('../src/sync/crdt.js');
    const local  = [{ id: 'n1', type: 'decision', properties: { statement: 'old' }, importance: 0.5, ts: 100, workspaceHash: 'ws1' }];
    const remote = [{ id: 'n1', type: 'decision', properties: { statement: 'new' }, importance: 0.8, ts: 200, workspaceHash: 'ws2' }];
    const merged = mergeLwwNodes(local, remote);
    expect(merged[0]!.properties['statement']).toBe('new');
    expect(merged[0]!.ts).toBe(200);
  });

  it('local wins when its timestamp is higher', async () => {
    const { mergeLwwNodes } = await import('../src/sync/crdt.js');
    const local  = [{ id: 'n1', type: 'decision', properties: { statement: 'local-wins' }, importance: 0.9, ts: 500, workspaceHash: 'ws1' }];
    const remote = [{ id: 'n1', type: 'decision', properties: { statement: 'remote-old' }, importance: 0.3, ts: 100, workspaceHash: 'ws2' }];
    const merged = mergeLwwNodes(local, remote);
    expect(merged[0]!.properties['statement']).toBe('local-wins');
  });

  it('deterministic tie-break on equal timestamps (higher workspaceHash wins)', async () => {
    const { mergeLwwNodes } = await import('../src/sync/crdt.js');
    const ts = 999;
    const a = { id: 'n1', type: 'decision', properties: { v: 'a' }, importance: 0.5, ts, workspaceHash: 'aaa' };
    const b = { id: 'n1', type: 'decision', properties: { v: 'b' }, importance: 0.5, ts, workspaceHash: 'zzz' };
    const merged = mergeLwwNodes([a], [b]);
    expect(merged[0]!.properties['v']).toBe('b'); // 'zzz' > 'aaa'
  });

  it('merges disjoint sets (no overlap)', async () => {
    const { mergeLwwNodes } = await import('../src/sync/crdt.js');
    const local  = [{ id: 'n1', type: 'decision', properties: {}, importance: 0.5, ts: 1, workspaceHash: 'ws1' }];
    const remote = [{ id: 'n2', type: 'decision', properties: {}, importance: 0.6, ts: 1, workspaceHash: 'ws2' }];
    const merged = mergeLwwNodes(local, remote);
    expect(merged).toHaveLength(2);
  });
});

// ── CRDT — 2P-Set edge merge ──────────────────────────────────────────────────

describe('CRDT 2P-Set edge merge', () => {
  const baseEdge = { source_id: 's', target_id: 't', rel_type: 'CALLS', weight: 1.0, properties: {}, workspaceHash: 'ws1' };

  it('includes alive edges', async () => {
    const { mergeTwoPSetEdges } = await import('../src/sync/crdt.js');
    const local  = [{ ...baseEdge, id: 'e1', addedAt: 100, removedAt: null }];
    const remote = [{ ...baseEdge, id: 'e2', addedAt: 200, removedAt: null }];
    const merged = mergeTwoPSetEdges(local, remote);
    expect(merged).toHaveLength(2);
  });

  it('excludes edges removed after add', async () => {
    const { mergeTwoPSetEdges } = await import('../src/sync/crdt.js');
    const local  = [{ ...baseEdge, id: 'e1', addedAt: 100, removedAt: 200 }]; // removed after add
    const merged = mergeTwoPSetEdges(local, []);
    expect(merged).toHaveLength(0);
  });

  it('keeps edge when added is after removed (re-add wins)', async () => {
    const { mergeTwoPSetEdges } = await import('../src/sync/crdt.js');
    const local  = [{ ...baseEdge, id: 'e1', addedAt: 300, removedAt: 200 }]; // re-added after removal
    const merged = mergeTwoPSetEdges(local, []);
    expect(merged).toHaveLength(1);
  });

  it('merges removal from remote', async () => {
    const { mergeTwoPSetEdges } = await import('../src/sync/crdt.js');
    const local  = [{ ...baseEdge, id: 'e1', addedAt: 100, removedAt: null }];
    const remote = [{ ...baseEdge, id: 'e1', addedAt: 100, removedAt: 200 }]; // remote removed it
    const merged = mergeTwoPSetEdges(local, remote);
    expect(merged).toHaveLength(0);
  });
});

// ── CRDT — Encryption round-trip ─────────────────────────────────────────────

describe('CRDT AES-256-GCM encryption', () => {
  it('encrypts and decrypts payload correctly', async () => {
    const { encryptPayload, decryptPayload } = await import('../src/sync/crdt.js');
    const payload = {
      version: 1 as const, workspaceHash: 'abc123', exportedAt: Date.now(),
      nodes: [{ id: 'n1', type: 'decision', properties: { secret: 'val' }, importance: 0.5, ts: 1, workspaceHash: 'abc123' }],
      edges: [],
    };
    const enc = encryptPayload(payload, 'my-shared-key-42');
    expect(enc.ciphertext).not.toContain('secret');
    const dec = decryptPayload(enc, 'my-shared-key-42');
    expect(dec.nodes[0]!.properties['secret']).toBe('val');
  });

  it('throws on wrong key', async () => {
    const { encryptPayload, decryptPayload } = await import('../src/sync/crdt.js');
    const payload = { version: 1 as const, workspaceHash: 'x', exportedAt: 0, nodes: [], edges: [] };
    const enc = encryptPayload(payload, 'correct-key');
    expect(() => decryptPayload(enc, 'wrong-key')).toThrow();
  });
});

// ── Sync transport — folder ───────────────────────────────────────────────────

describe('sync transport — shared folder', () => {
  let ws: string;
  beforeAll(async () => {
    ws = tmpDir();
    process.env['EIDOS_WORKSPACE'] = ws;
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
  });

  it('exports and re-imports via shared folder', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { upsertNode } = await import('../src/store/nodes.js');
    const { syncToFolder } = await import('../src/sync/transport.js');

    const db = getDb();
    upsertNode(db, { type: 'decision', properties: { statement: 'Use SQLite' }, importance: 0.9 });

    const sharedFolder = tmpDir();
    syncToFolder(db, ws, sharedFolder, 'test-key');

    // A second workspace imports from that folder
    const ws2 = tmpDir();
    process.env['EIDOS_WORKSPACE'] = ws2;
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
    const { getDb: getDb2 } = await import('../src/store/db.js');
    const db2 = getDb2();

    syncToFolder(db2, ws2, sharedFolder, 'test-key');

    const { countNodes } = await import('../src/store/nodes.js');
    expect(countNodes(db2, 'decision')).toBeGreaterThanOrEqual(1);
  });
});

// ── Dashboard server ──────────────────────────────────────────────────────────

describe('dashboard server', () => {
  it('exports startDashboard function', async () => {
    const { startDashboard } = await import('../src/dashboard/server.js');
    expect(startDashboard).toBeTypeOf('function');
  });
});
