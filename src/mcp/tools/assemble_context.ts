import { getDb } from '../../store/db.js';
import { embed } from '../../engine/embedding.js';
import { assembleContext } from '../../engine/retrieval.js';
import { listNodes } from '../../store/nodes.js';
import { estimateBudget } from '../../engine/budget.js';
import { writeAuditEntry } from '../../engine/audit.js';
import fs from 'fs';
import path from 'path';

function loadConfig(): { token_budget: number; adaptive_budget: boolean; model_cost_per_1k_tokens: number } {
  try {
    const cfgPath = path.join(process.cwd(), 'eidos.config.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return { token_budget: 2000, adaptive_budget: true, model_cost_per_1k_tokens: 0.015 };
}

// Session-level cache of last assembled node IDs (for delta)
const _sessionLastNodes = new Map<string, Set<string>>();

export function getSessionLastNodes(sessionId: string): Set<string> {
  return _sessionLastNodes.get(sessionId) ?? new Set();
}

export async function handleAssembleContext(params: Record<string, unknown>) {
  const db = getDb();
  const query       = String(params['query'] ?? '');
  const activeFile  = params['active_file'] ? String(params['active_file']) : null;
  const sessionId   = params['session_id'] ? String(params['session_id']) : 'default';
  const activeFileId = activeFile ? `file:${activeFile}` : null;

  // Adaptive budget
  const config = loadConfig();
  const budgetOverride = params['budget'] ? Number(params['budget']) : null;
  const budgetEstimate = budgetOverride
    ? { budget: budgetOverride, intent: 'explanation' as const, confidence: 1, reason: 'override' }
    : await estimateBudget(query, config);
  const budget = budgetEstimate.budget;

  // Build essentials: active task + last 3 conversation turns
  const essentials: Array<{ label: string; content: string }> = [];

  // Pull last 3 turns for this session
  const turns = listNodes(db, 'conversation_turn', 20)
    .filter((n) => (n.properties as Record<string, unknown>)['session_id'] === sessionId)
    .slice(-3);
  for (const t of turns) {
    const p = t.properties as Record<string, unknown>;
    essentials.push({ label: `${p['role']}`, content: String(p['micro_summary'] ?? p['content'] ?? '') });
  }

  const queryEmbedding = await embed(query);
  const result = await assembleContext(db, query, queryEmbedding, activeFileId, budget, essentials);

  // Record node IDs for delta computation
  const nodeIds = new Set(result.breakdown.map((b) => b.id));
  _sessionLastNodes.set(sessionId, nodeIds);

  // Audit log
  writeAuditEntry({
    ts: Date.now(),
    event: 'context_assembled',
    sessionId,
    tokens: result.tokens,
    tokensSaved: result.tokensSaved,
    nodeCount: nodeIds.size,
    detail: budgetEstimate.reason,
  });

  return {
    content: [{
      type: 'text',
      text: result.contextString,
    }],
    _meta: {
      tokens: result.tokens,
      tokens_saved: result.tokensSaved,
      budget_used: budget,
      intent: budgetEstimate.intent,
      intent_confidence: budgetEstimate.confidence,
      budget_reason: budgetEstimate.reason,
      breakdown: result.breakdown,
    },
  };
}
