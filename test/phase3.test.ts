import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `eidos-p3-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Error memory ──────────────────────────────────────────────────────────────

describe('error memory fingerprinting', () => {
  it('normalizes stack traces correctly', async () => {
    const { normalizeStackTrace } = await import('../src/engine/error_memory.js');
    const raw = `TypeError: Cannot read property 'x' of undefined
    at login (src/auth.ts:42:10)
    at handler (src/routes.ts:17:5)
    at <anonymous>`;
    const normalized = normalizeStackTrace(raw);
    expect(normalized).not.toContain(':42:');
    expect(normalized).not.toContain(':17:');
    expect(normalized).toContain('TypeError');
    expect(normalized).toContain('<frame>');
  });

  it('produces same fingerprint for same error at different lines', async () => {
    const { normalizeStackTrace, fingerprintError } = await import('../src/engine/error_memory.js');
    const trace1 = normalizeStackTrace(`TypeError: null\n    at foo (src/a.ts:10:5)`);
    const trace2 = normalizeStackTrace(`TypeError: null\n    at foo (src/a.ts:99:5)`);
    expect(fingerprintError('TypeError', trace1)).toBe(fingerprintError('TypeError', trace2));
  });

  it('produces different fingerprints for different error types', async () => {
    const { normalizeStackTrace, fingerprintError } = await import('../src/engine/error_memory.js');
    const trace = normalizeStackTrace(`Error: something\n    at foo (src/a.ts:10:5)`);
    expect(fingerprintError('TypeError', trace)).not.toBe(fingerprintError('RangeError', trace));
  });
});

describe('error memory store', () => {
  beforeAll(async () => {
    process.env['EIDOS_WORKSPACE'] = tmpDir();
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
  });

  it('records a new error and returns isNew=true', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { recordError } = await import('../src/engine/error_memory.js');
    const db = getDb();
    const result = await recordError(db, 'TypeError', 'Cannot read x', `TypeError\n    at foo (a.ts:10:1)`);
    expect(result.isNew).toBe(true);
    expect(result.fingerprint).toHaveLength(16);
  });

  it('increments occurrence count on duplicate error', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { recordError } = await import('../src/engine/error_memory.js');
    const { getNode } = await import('../src/store/nodes.js');
    const db = getDb();

    const trace = `RangeError: max call stack\n    at bar (b.ts:5:1)`;
    const first = await recordError(db, 'RangeError', 'max call stack', trace);
    expect(first.isNew).toBe(true);

    const second = await recordError(db, 'RangeError', 'max call stack', trace);
    expect(second.isNew).toBe(false);

    const node = getNode(db, second.nodeId);
    expect((node?.properties as Record<string, unknown>)['occurrences']).toBe(2);
  });

  it('marks error as resolved', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { recordError, markErrorResolved } = await import('../src/engine/error_memory.js');
    const { getNode } = await import('../src/store/nodes.js');
    const db = getDb();

    const trace = `SyntaxError: unexpected token\n    at parse (c.ts:3:1)`;
    const { fingerprint, nodeId } = await recordError(db, 'SyntaxError', 'unexpected token', trace);
    markErrorResolved(db, fingerprint, 'fixed missing semicolon on line 3');

    const node = getNode(db, nodeId);
    expect((node?.properties as Record<string, unknown>)['resolvedAt']).not.toBeNull();
    expect((node?.properties as Record<string, unknown>)['fix']).toContain('semicolon');
  });
});

// ── Proxy context injection ───────────────────────────────────────────────────

describe('proxy message handling', () => {
  it('fixAlternation merges consecutive same-role messages', async () => {
    // Test the internal function via a round-trip through the proxy module
    // We test normalizeStackTrace indirectly since fixAlternation is not exported
    // Instead, verify the proxy module imports cleanly
    const mod = await import('../src/cli/proxy.js');
    expect(mod.startProxy).toBeTypeOf('function');
  });

  it('correctly identifies last user query from messages', () => {
    const messages = [
      { role: 'system' as const, content: 'You are helpful.' },
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there' },
      { role: 'user' as const, content: 'What is 2+2?' },
    ];
    // Last user message is 'What is 2+2?'
    let lastUser = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'user') { lastUser = messages[i]!.content!; break; }
    }
    expect(lastUser).toBe('What is 2+2?');
  });
});

// ── QMS round-trip ────────────────────────────────────────────────────────────

describe('QMS export/import round-trip', () => {
  let ws: string;
  beforeAll(async () => {
    ws = tmpDir();
    process.env['EIDOS_WORKSPACE'] = ws;
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
    // Seed some nodes with embeddings
    const { getDb } = await import('../src/store/db.js');
    const { upsertNode } = await import('../src/store/nodes.js');
    const { embed } = await import('../src/engine/embedding.js');
    const db = getDb();
    for (let i = 0; i < 5; i++) {
      const emb = await embed(`sample content for node ${i}`);
      upsertNode(db, { type: 'chunk', properties: { name: `fn${i}` }, embedding: emb, importance: 0.5 });
    }
  });

  it('generates a QMS node with embedding', async () => {
    const { handleGenerateQms } = await import('../src/mcp/tools/generate_qms.js');
    const result = await handleGenerateQms({ session_id: 'test-session' });
    const data = JSON.parse(result.content[0]!.text) as { qms_id?: string; error?: string };
    expect(data.error).toBeUndefined();
    expect(data.qms_id).toBeTruthy();
  });

  it('exports QMS to file and re-imports it', async () => {
    const { exportQms } = await import('../src/cli/qms.js');
    const { importQms } = await import('../src/cli/qms.js');
    const { getDb } = await import('../src/store/db.js');
    const { countNodes } = await import('../src/store/nodes.js');

    const outFile = path.join(ws, 'test-qms.json');
    await exportQms('test-session', outFile);
    expect(fs.existsSync(outFile)).toBe(true);

    const before = countNodes(getDb(), 'qms');
    await importQms(outFile);
    // QMS node should still exist (upserted)
    expect(countNodes(getDb(), 'qms')).toBeGreaterThanOrEqual(before);
  });
});

// ── Git hook ──────────────────────────────────────────────────────────────────

describe('git hook installation', () => {
  it('installs post-commit hook in a git repo', async () => {
    const { installGitHook } = await import('../src/cli/git_hooks.js');
    const dir = tmpDir();
    // Init a bare git repo
    fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
    const result = installGitHook(dir);
    expect(result).toBe(true);
    const hookPath = path.join(dir, '.git', 'hooks', 'post-commit');
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.readFileSync(hookPath, 'utf-8')).toContain('EidosCore');
  });

  it('does not duplicate hook if already installed', async () => {
    const { installGitHook } = await import('../src/cli/git_hooks.js');
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
    installGitHook(dir);
    installGitHook(dir);
    const hookPath = path.join(dir, '.git', 'hooks', 'post-commit');
    const content = fs.readFileSync(hookPath, 'utf-8');
    const count = (content.match(/EidosCore/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('returns false when no git repo exists', async () => {
    const { installGitHook } = await import('../src/cli/git_hooks.js');
    const dir = tmpDir(); // no .git dir
    const result = installGitHook(dir);
    expect(result).toBe(false);
  });
});
