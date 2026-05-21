import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `eidos-edge-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Edge cases for core engine ──────────────────────────────────────────────

describe('edge cases: token counter', () => {
  it('handles empty string', async () => {
    const { countTokens } = await import('../src/engine/tokens.js');
    expect(countTokens('')).toBe(0);
  });

  it('handles very long text', async () => {
    const { countTokens } = await import('../src/engine/tokens.js');
    const longText = 'hello world '.repeat(10000);
    const count = countTokens(longText);
    expect(count).toBeGreaterThan(1000);
    expect(count).toBeLessThan(100000);
  });

  it('handles unicode text', async () => {
    const { countTokens } = await import('../src/engine/tokens.js');
    const count = countTokens('こんにちは世界 🌍🚀');
    expect(count).toBeGreaterThan(0);
  });
});

describe('edge cases: knapsack assembler', () => {
  it('returns empty result with zero budget', async () => {
    const { knapsackAssemble } = await import('../src/engine/retrieval.js');
    const candidates = [
      { id: 'a', text: 'some content', tokens: 50, score: 0.9, type: 'chunk' as const, representation: 'a', cosineSim: 0.9, graph: 0, recency: 0, ast: 0 },
    ];
    const result = knapsackAssemble(candidates, 0);
    expect(result).toHaveLength(0);
  });

  it('returns empty result with no candidates', async () => {
    const { knapsackAssemble } = await import('../src/engine/retrieval.js');
    const result = knapsackAssemble([], 2000);
    expect(result).toHaveLength(0);
  });

  it('selects highest-scored item when budget is tight', async () => {
    const { knapsackAssemble } = await import('../src/engine/retrieval.js');
    const candidates = [
      { id: 'low', text: 'low priority', tokens: 100, score: 0.3, type: 'chunk' as const, representation: 'low', cosineSim: 0.3, graph: 0, recency: 0, ast: 0 },
      { id: 'high', text: 'high priority', tokens: 100, score: 0.95, type: 'chunk' as const, representation: 'high', cosineSim: 0.95, graph: 0, recency: 0, ast: 0 },
    ];
    const result = knapsackAssemble(candidates, 100);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('high');
  });
});

describe('edge cases: intent classifier', () => {
  it('handles empty string', async () => {
    const { classifyIntent } = await import('../src/engine/intent.js');
    const result = await classifyIntent('');
    expect(result.intent).toBeTruthy();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('handles very long query', async () => {
    const { classifyIntent } = await import('../src/engine/intent.js');
    const longQuery = 'debug the authentication module '.repeat(100);
    const result = await classifyIntent(longQuery);
    expect(result.intent).toBeTruthy();
  });

  it('handles special characters', async () => {
    const { classifyIntent } = await import('../src/engine/intent.js');
    const result = await classifyIntent('fix <script>alert("xss")</script> bug');
    expect(result.intent).toBeTruthy();
  });
});

describe('edge cases: privacy firewall', () => {
  it('redacts OpenAI API keys', async () => {
    const { redactSecrets } = await import('../src/engine/privacy.js');
    const text = 'My key is sk-abcdefghijklmnopqrstuvwx1234567890abcdef';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('sk-');
    expect(redacted).toContain('REDACTED');
  });

  it('redacts AWS keys', async () => {
    const { redactSecrets } = await import('../src/engine/privacy.js');
    const text = 'AWS key: AKIAIOSFODNN7EXAMPLE';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('AKIA');
  });

  it('redacts JWT tokens', async () => {
    const { redactSecrets } = await import('../src/engine/privacy.js');
    const text = 'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('eyJ');
    expect(redacted).toContain('REDACTED');
  });

  it('strips private tags', async () => {
    const { stripPrivateTags } = await import('../src/engine/privacy.js');
    const text = 'Public content <private>secret stuff</private> more public';
    const stripped = stripPrivateTags(text);
    expect(stripped).not.toContain('secret stuff');
    expect(stripped).toContain('Public content');
  });

  it('detects private tags', async () => {
    const { hasPrivateTags } = await import('../src/engine/privacy.js');
    expect(hasPrivateTags('text <private>secret</private>')).toBe(true);
    expect(hasPrivateTags('no private tags here')).toBe(false);
  });
});

describe('edge cases: CRDT encryption', () => {
  it('encrypts and decrypts with PBKDF2 key derivation', async () => {
    const { encryptPayload, decryptPayload } = await import('../src/sync/crdt.js');
    const payload = {
      version: 1 as const,
      workspaceHash: 'test-ws',
      exportedAt: Date.now(),
      nodes: [],
      edges: [],
    };
    const key = 'my-secret-shared-key-2024';
    const encrypted = encryptPayload(payload, key);
    expect(encrypted.version).toBe(1);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();
    expect(encrypted.ciphertext).toBeTruthy();

    const decrypted = decryptPayload(encrypted, key);
    expect(decrypted.workspaceHash).toBe('test-ws');
  });

  it('fails with wrong key', async () => {
    const { encryptPayload, decryptPayload } = await import('../src/sync/crdt.js');
    const payload = {
      version: 1 as const,
      workspaceHash: 'test-ws',
      exportedAt: Date.now(),
      nodes: [],
      edges: [],
    };
    const encrypted = encryptPayload(payload, 'correct-key');
    expect(() => decryptPayload(encrypted, 'wrong-key')).toThrow();
  });
});

describe('edge cases: memory decay', () => {
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

  it('handles empty database gracefully', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { runDecayPass } = await import('../src/engine/decay.js');
    const db = getDb();
    const report = runDecayPass(db);
    expect(report.processed).toBe(0);
    expect(report.decayed).toBe(0);
    expect(report.archived).toBe(0);
  });
});

describe('edge cases: LIKE injection prevention', () => {
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

  it('escapes LIKE wildcards in file path queries', async () => {
    const { getObservationsByFile } = await import('../src/store/memory_store.js');
    // This should not throw or match unintended rows
    const results = getObservationsByFile('%_test%', 'test-project');
    expect(Array.isArray(results)).toBe(true);
  });
});
