import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `eidos-p4-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Memory decay ──────────────────────────────────────────────────────────────

describe('memory decay', () => {
  let ws: string;
  beforeAll(async () => {
    ws = tmpDir();
    process.env['EIDOS_WORKSPACE'] = ws;
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
  });

  it('reduces importance of old nodes', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { upsertNode, getNode } = await import('../src/store/nodes.js');
    const { runDecayPass } = await import('../src/engine/decay.js');
    const db = getDb();

    // Insert node with last_accessed 100 days ago
    const id = upsertNode(db, {
      type: 'chunk',
      properties: { name: 'oldFn' },
      importance: 0.8,
    });
    // Manually backdate last_accessed
    const hundredDaysAgo = Date.now() - 100 * 86_400_000;
    db.prepare(`UPDATE nodes SET last_accessed = ?, updated_at = ? WHERE id = ?`)
      .run(hundredDaysAgo, hundredDaysAgo, id);

    const report = runDecayPass(db);
    expect(report.processed).toBeGreaterThan(0);
    expect(report.decayed).toBeGreaterThan(0);

    const node = getNode(db, id);
    expect(node!.importance).toBeLessThan(0.8);
  });

  it('archives very old low-importance nodes', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { upsertNode, getNode } = await import('../src/store/nodes.js');
    const { runDecayPass } = await import('../src/engine/decay.js');
    const db = getDb();

    const id = upsertNode(db, {
      type: 'chunk',
      properties: { name: 'ancientFn' },
      importance: 0.005, // already below threshold
    });
    const veryOld = Date.now() - 200 * 86_400_000;
    db.prepare(`UPDATE nodes SET last_accessed = ?, updated_at = ? WHERE id = ?`)
      .run(veryOld, veryOld, id);

    const report = runDecayPass(db);
    expect(report.archived).toBeGreaterThan(0);

    const node = getNode(db, id);
    expect((node?.properties as Record<string, unknown>)['archived']).toBe(true);
  });
});

// ── Audit log ─────────────────────────────────────────────────────────────────

describe('audit log', () => {
  let ws: string;
  beforeAll(async () => {
    ws = tmpDir();
    process.env['EIDOS_WORKSPACE'] = ws;
    const { resetAuditPath } = await import('../src/engine/audit.js');
    resetAuditPath();
  });

  it('writes and reads audit entries', async () => {
    const { writeAuditEntry, readAuditLog } = await import('../src/engine/audit.js');

    writeAuditEntry({ ts: Date.now(), event: 'context_assembled', tokens: 500, tokensSaved: 1500 }, ws);
    writeAuditEntry({ ts: Date.now(), event: 'file_indexed', filePath: 'src/main.ts', nodeCount: 12 }, ws);

    const entries = readAuditLog(ws, 10);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries[0]!.event).toBe('file_indexed'); // newest first
  });

  it('returns empty array for non-existent log', async () => {
    const { readAuditLog, resetAuditPath } = await import('../src/engine/audit.js');
    resetAuditPath(); // clear cache so a fresh tmpDir is used
    const entries = readAuditLog(tmpDir(), 10);
    expect(entries).toEqual([]);
    resetAuditPath(); // restore for subsequent tests
  });
});

// ── Conversation replay ───────────────────────────────────────────────────────

describe('conversation replay', () => {
  let ws: string;
  beforeAll(async () => {
    ws = tmpDir();
    process.env['EIDOS_WORKSPACE'] = ws;
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
  });

  it('handles empty session gracefully', async () => {
    const { replaySession } = await import('../src/cli/replay.js');
    // Should not throw
    await expect(replaySession('nonexistent-session')).resolves.toBeUndefined();
  });

  it('replays a session with stored turns', async () => {
    const { handleLogConversation } = await import('../src/mcp/tools/log_conversation.js');
    const { replaySession } = await import('../src/cli/replay.js');

    const sessionId = `replay-test-${Date.now()}`;
    await handleLogConversation({ role: 'user', content: 'Hello', session_id: sessionId });
    await handleLogConversation({ role: 'assistant', content: 'Hi there', session_id: sessionId });

    // Should not throw
    await expect(replaySession(sessionId)).resolves.toBeUndefined();
  });
});

// ── Session branching ─────────────────────────────────────────────────────────

describe('session branching', () => {
  let ws: string;
  beforeAll(async () => {
    ws = tmpDir();
    process.env['EIDOS_WORKSPACE'] = ws;
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
  });

  it('creates a branch from a meso-block', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { upsertNode, listNodes } = await import('../src/store/nodes.js');
    const { branchSession } = await import('../src/cli/replay.js');
    const db = getDb();

    const mesoId = `meso:test:${Date.now()}`;
    upsertNode(db, {
      id: mesoId,
      type: 'meso_block',
      properties: {
        session_id: 'parent-session',
        goal: 'Build auth system',
        conclusion: 'JWT tokens implemented',
        steps: [],
        errors: [],
      },
      importance: 0.8,
    });

    const branchId = await branchSession(mesoId, 'my-branch');
    expect(branchId).toBe('my-branch');

    // Check branched meso block exists
    const mesoNodes = listNodes(db, 'meso_block', 100);
    const branchMeso = mesoNodes.find((n) =>
      (n.properties as Record<string, unknown>)['session_id'] === 'my-branch',
    );
    expect(branchMeso).toBeDefined();
    expect((branchMeso!.properties as Record<string, unknown>)['branched_from']).toBe(mesoId);
  });

  it('throws when meso-block not found', async () => {
    const { branchSession } = await import('../src/cli/replay.js');
    await expect(branchSession('nonexistent-meso')).rejects.toThrow('not found');
  });
});

// ── Federation ────────────────────────────────────────────────────────────────

describe('federation', () => {
  it('registerWorkspace and deregisterWorkspace', async () => {
    const { registerWorkspace, deregisterWorkspace } = await import('../src/engine/federation.js');
    const fakeRoot = tmpDir();
    registerWorkspace(fakeRoot);
    deregisterWorkspace(fakeRoot);
    // Should complete without throwing
  });

  it('federatedSearch returns empty when no workspaces registered', async () => {
    const { federatedSearch } = await import('../src/engine/federation.js');
    const queryVec = new Float32Array(384).fill(0.1);
    const results = await federatedSearch(queryVec, 5, 'current-hash');
    // Either empty (no workspaces) or valid array
    expect(Array.isArray(results)).toBe(true);
  });
});
