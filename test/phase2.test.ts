import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `eidos-p2-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Intent classifier ─────────────────────────────────────────────────────────

describe('intent classifier', () => {
  it('classifies debugging queries correctly', async () => {
    const { classifyIntent } = await import('../src/engine/intent.js');
    const result = await classifyIntent('why is this throwing a TypeError undefined?');
    expect(result.intent).toBe('debugging');
    expect(result.confidence).toBeGreaterThan(0.1);
  });

  it('classifies code implementation queries correctly', async () => {
    const { classifyIntent } = await import('../src/engine/intent.js');
    const result = await classifyIntent('implement a function that parses JSON');
    expect(['code_impl', 'explanation']).toContain(result.intent);
  });

  it('classifies decision recall queries correctly', async () => {
    const { classifyIntent } = await import('../src/engine/intent.js');
    const result = await classifyIntent('what did we decide about the database architecture?');
    expect(result.intent).toBe('decision_recall');
  });

  it('classifies recap queries correctly', async () => {
    const { classifyIntent } = await import('../src/engine/intent.js');
    const result = await classifyIntent('summarize what we have done so far in this session');
    expect(result.intent).toBe('recap');
  });

  it('returns all 5 intent scores', async () => {
    const { classifyIntent } = await import('../src/engine/intent.js');
    const result = await classifyIntent('explain how the auth module works');
    expect(Object.keys(result.scores)).toHaveLength(5);
    for (const score of Object.values(result.scores)) {
      expect(score).toBeGreaterThanOrEqual(-1);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// ── Adaptive budget ───────────────────────────────────────────────────────────

describe('adaptive budget', () => {
  const baseConfig = { token_budget: 2000, adaptive_budget: true, model_cost_per_1k_tokens: 0.015 };

  it('gives smaller budget for a simple recall query', async () => {
    const { estimateBudget } = await import('../src/engine/budget.js');
    const result = await estimateBudget('what did we decide?', baseConfig);
    expect(result.budget).toBeLessThan(1800);
  });

  it('gives larger budget for a complex implementation query', async () => {
    const { estimateBudget } = await import('../src/engine/budget.js');
    const result = await estimateBudget(
      'implement a complete authentication system with JWT refresh tokens, bcrypt hashing, rate limiting, session management and OAuth2 integration',
      baseConfig,
    );
    expect(result.budget).toBeGreaterThan(900);
  });

  it('respects adaptive_budget=false and returns config value', async () => {
    const { estimateBudget } = await import('../src/engine/budget.js');
    const result = await estimateBudget('anything', { ...baseConfig, adaptive_budget: false });
    expect(result.budget).toBe(2000);
  });

  it('stays within global min/max', async () => {
    const { estimateBudget } = await import('../src/engine/budget.js');
    for (const q of ['hi', 'why?', 'build a massive distributed system with 50 microservices']) {
      const r = await estimateBudget(q, baseConfig);
      expect(r.budget).toBeGreaterThanOrEqual(500);
      expect(r.budget).toBeLessThanOrEqual(4000);
    }
  });
});

// ── Summariser ────────────────────────────────────────────────────────────────

describe('local summariser', () => {
  it('returns shorter text for micro style', async () => {
    const { summarise } = await import('../src/engine/summariser/index.js');
    const long = 'This is a very long piece of text. '.repeat(20);
    const result = await summarise(long, 'local', { maxTokens: 30, style: 'micro' });
    expect(result.length).toBeLessThan(long.length);
  });

  it('produces non-empty output for meso style', async () => {
    const { summarise } = await import('../src/engine/summariser/index.js');
    const text = 'We implemented the login system. It uses bcrypt. JWT tokens are 24h. Refresh tokens work.';
    const result = await summarise(text, 'local', { style: 'meso' });
    expect(result.length).toBeGreaterThan(5);
  });
});

// ── Meso-block creation ───────────────────────────────────────────────────────

describe('meso-block folding', () => {
  beforeAll(async () => {
    process.env['EIDOS_WORKSPACE'] = tmpDir();
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
  });

  it('creates a meso_block node after 5 turns', async () => {
    const { handleLogConversation } = await import('../src/mcp/tools/log_conversation.js');
    const { getDb } = await import('../src/store/db.js');
    const { countNodes } = await import('../src/store/nodes.js');

    const sessionId = `test-meso-${Date.now()}`;

    // Log 5 turns
    for (let i = 0; i < 5; i++) {
      await handleLogConversation({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Turn ${i}: We are working on the auth module`,
        session_id: sessionId,
      });
    }

    const db = getDb();
    const mesoCount = countNodes(db, 'meso_block');
    expect(mesoCount).toBeGreaterThanOrEqual(1);
  });
});
