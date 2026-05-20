import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ── helpers ──────────────────────────────────────────────────────────────────

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `eidos-test-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

describe('skeleton generator', () => {
  it('produces output under 80 tokens for a simple function', async () => {
    const { generateSkeleton } = await import('../src/engine/ingestion/skeleton.js');
    const { countTokens } = await import('../src/engine/tokens.js');

    const chunk = {
      id: 'test',
      filePath: 'test.py',
      language: 'python',
      startLine: 0,
      endLine: 5,
      fullBody: `def login(credentials):\n    result = bcrypt.compare(credentials.password)\n    if not result:\n        raise InvalidCredentials()\n    return session_token`,
      chunkType: 'function' as const,
      name: 'login',
      confidence: 'high' as const,
    };

    const sk = generateSkeleton(chunk);
    const { formatSkeleton } = await import('../src/engine/ingestion/skeleton.js');
    const text = formatSkeleton(sk);
    const tokens = countTokens(text);

    expect(tokens).toBeLessThan(80);
    expect(text).toContain('login');
  });
});

// ── Token counter ─────────────────────────────────────────────────────────────

describe('token counter', () => {
  it('counts tokens correctly', async () => {
    const { countTokens } = await import('../src/engine/tokens.js');
    const count = countTokens('Hello world this is a test');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
  });

  it('returns 0 for empty string', async () => {
    const { countTokens } = await import('../src/engine/tokens.js');
    expect(countTokens('')).toBe(0);
  });
});

// ── Differ ────────────────────────────────────────────────────────────────────

describe('differ', () => {
  it('detects changes between two texts', async () => {
    const { computeDiff } = await import('../src/engine/ingestion/differ.js');
    const result = computeDiff('hello world', 'hello universe');
    expect(result.hasChanges).toBe(true);
    expect(result.added).toBeGreaterThan(0);
  });

  it('returns no changes for identical texts', async () => {
    const { computeDiff } = await import('../src/engine/ingestion/differ.js');
    const result = computeDiff('same text', 'same text');
    expect(result.hasChanges).toBe(false);
  });
});

// ── Knapsack ─────────────────────────────────────────────────────────────────

describe('knapsack assembler', () => {
  it('fits all items within budget', async () => {
    const { knapsackAssemble } = await import('../src/engine/retrieval.js');
    const candidates = [
      { id: 'a', type: 'chunk', representation: 'fn a()', tokens: 10, score: 0.9, cosineSim: 0.9, graphBoost: 1, recencyBoost: 0.8 },
      { id: 'b', type: 'chunk', representation: 'fn b()', tokens: 20, score: 0.8, cosineSim: 0.8, graphBoost: 1, recencyBoost: 0.7 },
      { id: 'c', type: 'chunk', representation: 'fn c()', tokens: 500, score: 0.7, cosineSim: 0.7, graphBoost: 1, recencyBoost: 0.6 },
    ];
    const budget = 50;
    const selected = knapsackAssemble(candidates, budget);
    const totalTokens = selected.reduce((s, c) => s + c.tokens, 0);
    expect(totalTokens).toBeLessThanOrEqual(budget);
  });

  it('selects highest score/token ratio first', async () => {
    const { knapsackAssemble } = await import('../src/engine/retrieval.js');
    const candidates = [
      { id: 'high', type: 'chunk', representation: 'a', tokens: 5,  score: 0.9, cosineSim: 0.9, graphBoost: 1, recencyBoost: 1 },
      { id: 'low',  type: 'chunk', representation: 'b', tokens: 100, score: 0.5, cosineSim: 0.5, graphBoost: 1, recencyBoost: 0.5 },
    ];
    const selected = knapsackAssemble(candidates, 50);
    expect(selected[0]?.id).toBe('high');
  });
});

// ── Privacy firewall ─────────────────────────────────────────────────────────

describe('privacy firewall', () => {
  it('redacts OpenAI API keys', async () => {
    const { redactSecrets } = await import('../src/engine/privacy.js');
    const text = 'Use this key: sk-abcdefghijklmnopqrstu12345678';
    const result = redactSecrets(text);
    expect(result).not.toContain('sk-abcdefghijklmnopqrstu12345678');
    expect(result).toContain('[REDACTED');
  });

  it('redacts JWT tokens', async () => {
    const { redactSecrets } = await import('../src/engine/privacy.js');
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = redactSecrets(jwt);
    expect(result).toContain('[REDACTED_JWT]');
  });

  it('respects .eidosignore', async () => {
    const { initPrivacyFirewall, isFileAllowed } = await import('../src/engine/privacy.js');
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, '.eidosignore'), 'secrets/\n*.key\n');
    initPrivacyFirewall(dir);
    expect(isFileAllowed(path.join(dir, 'secrets', 'prod.txt'))).toBe(false);
    expect(isFileAllowed(path.join(dir, 'src', 'main.ts'))).toBe(true);
  });
});

// ── Chunker (fallback) ────────────────────────────────────────────────────────

describe('chunker fallback', () => {
  it('produces chunks for a text file', async () => {
    const { chunkFile } = await import('../src/engine/ingestion/chunker.js');
    const dir = tmpDir();
    const file = path.join(dir, 'sample.py');
    const lines = Array.from({ length: 130 }, (_, i) => `# line ${i}\nprint(${i})`).join('\n');
    fs.writeFileSync(file, lines);
    const chunks = await chunkFile(file);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

// ── DB store ──────────────────────────────────────────────────────────────────

describe('SQLite store', () => {
  beforeAll(async () => {
    process.env['EIDOS_WORKSPACE'] = tmpDir();
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
  });

  it('upserts and retrieves a node', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { upsertNode, getNode } = await import('../src/store/nodes.js');
    const db = getDb();

    const id = upsertNode(db, {
      type: 'decision',
      properties: { statement: 'Use SQLite', tags: [] },
      importance: 0.9,
    });

    const node = getNode(db, id);
    expect(node).not.toBeNull();
    expect(node?.type).toBe('decision');
    expect((node?.properties as Record<string, unknown>)['statement']).toBe('Use SQLite');
  });

  it('upserts and retrieves an edge', async () => {
    const { getDb } = await import('../src/store/db.js');
    const { upsertNode } = await import('../src/store/nodes.js');
    const { upsertEdge, getEdgesFrom } = await import('../src/store/edges.js');
    const db = getDb();

    const a = upsertNode(db, { type: 'chunk', properties: { name: 'fnA' }, importance: 0.5 });
    const b = upsertNode(db, { type: 'chunk', properties: { name: 'fnB' }, importance: 0.5 });
    upsertEdge(db, { source_id: a, target_id: b, rel_type: 'DEPENDS_ON', weight: 1.0, properties: {} });

    const edges = getEdgesFrom(db, a, 'DEPENDS_ON');
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0]?.target_id).toBe(b);
  });
});

// ── Cosine similarity ─────────────────────────────────────────────────────────

describe('cosine similarity', () => {
  it('self-similarity is 1.0', async () => {
    const { cosineSimilarity } = await import('../src/store/vector.js');
    const v = new Float32Array([0.1, 0.5, 0.3, 0.8]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 4);
  });

  it('orthogonal vectors are 0', async () => {
    const { cosineSimilarity } = await import('../src/store/vector.js');
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 4);
  });
});
