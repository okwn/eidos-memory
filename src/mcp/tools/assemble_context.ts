import { getDb } from '../../store/db.js';
import { embed } from '../../engine/embedding.js';
import { assembleContext } from '../../engine/retrieval.js';
import { estimateBudget } from '../../engine/budget.js';
import { writeAuditEntry } from '../../engine/audit.js';
import { recordImplicitFeedback } from './feedback.js';
import { indexProject } from './index_project.js';
import { handleGenerateQms } from './generate_qms.js';
import { buildEssentialsFromTurns } from '../../engine/essentials.js';
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
// Track which sessions have had their first call (for hint injection)
const _sessionFirstCall = new Set<string>();
// Track last assemble timestamp per session (for implicit re-search detection)
const _sessionLastAssemble = new Map<string, number>();
// Track which workspaces have been fully indexed (to avoid re-indexing)
const _fullyIndexedWorkspaces = new Set<string>();

const MAX_CACHE_ENTRIES = 1000;

/** Evict oldest entries from unbounded caches to prevent memory leaks. */
function evictIfNeeded(): void {
  if (_sessionLastNodes.size > MAX_CACHE_ENTRIES) {
    const oldest = [..._sessionLastNodes.keys()].slice(0, _sessionLastNodes.size - MAX_CACHE_ENTRIES);
    for (const k of oldest) { _sessionLastNodes.delete(k); _sessionFirstCall.delete(k); _sessionLastAssemble.delete(k); }
  }
}

export function getSessionLastNodes(sessionId: string): Set<string> {
  return _sessionLastNodes.get(sessionId) ?? new Set();
}

/**
 * Synchronous full project index on first call.
 * This is the "first impression" — if the AI gets rich context on the first call,
 * it will trust Eidos and use it automatically for every subsequent call.
 *
 * The 2-5 second delay happens exactly once per project. After that, every call is fast.
 */
async function fullIndexOnFirstCall(sessionId: string): Promise<{ didIndex: boolean; indexResult: { node_count: number; chunk_count: number; file_count: number; duration_ms: number } | null }> {
  const workspace = process.env['EIDOS_WORKSPACE'] || process.cwd();
  const db = getDb();
  const nodeCount = db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };

  // Already indexed — skip
  if (nodeCount.count > 0 || _fullyIndexedWorkspaces.has(workspace)) {
    return { didIndex: false, indexResult: null };
  }

  // Synchronous full index with progress indicator
  const GREEN = '\x1b[32m'; const CYAN = '\x1b[36m'; const RESET = '\x1b[0m';
  process.stderr.write(`\n${CYAN}[eidos] First time in this project. Running full index...${RESET}\n`);

  const startTime = Date.now();
  let indexResult: { node_count: number; chunk_count: number; file_count: number; duration_ms: number };

  try {
    indexResult = await indexProject({ path: workspace });
  } catch (err) {
    process.stderr.write(`[eidos] Index failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return { didIndex: false, indexResult: null };
  }

  const duration = Date.now() - startTime;
  _fullyIndexedWorkspaces.add(workspace);

  process.stderr.write(`${GREEN}[eidos] Indexed ${indexResult.file_count} files → ${indexResult.node_count} nodes (${indexResult.chunk_count} chunks) in ${(duration / 1000).toFixed(1)}s${RESET}\n`);

  // Generate initial QMS so next session resumes instantly
  try {
    await handleGenerateQms({ session_id: sessionId });
    process.stderr.write(`${GREEN}[eidos] QMS snapshot saved for session continuity${RESET}\n`);
  } catch { /* non-critical */ }

  return { didIndex: true, indexResult };
}

export async function handleAssembleContext(params: Record<string, unknown>) {
  const db = getDb();
  const query       = String(params['query'] ?? 'Understand the current project structure, recent changes, and key decisions');
  const activeFile  = params['active_file'] ? String(params['active_file']) : null;
  const sessionId   = params['session_id'] ? String(params['session_id']) : 'default';
  const activeFileId = activeFile ? `file:${activeFile}` : null;

  // Synchronous full index on first call — this is the "first impression"
  const { didIndex, indexResult } = await fullIndexOnFirstCall(sessionId);

  // Track if this is the first call for this session (for hint injection)
  const isFirstCall = !_sessionFirstCall.has(sessionId);
  if (isFirstCall) _sessionFirstCall.add(sessionId);

  // Adaptive budget
  const config = loadConfig();
  const budgetOverride = params['budget'] ? Number(params['budget']) : null;
  const budgetEstimate = budgetOverride
    ? { budget: budgetOverride, intent: 'explanation' as const, confidence: 1, reason: 'override' }
    : await estimateBudget(query, config);
  const budget = budgetEstimate.budget;

  // Build essentials: active task + last 3 conversation turns
  const essentials = buildEssentialsFromTurns(db, sessionId);

  const queryEmbedding = await embed(query);
  const result = await assembleContext(db, query, queryEmbedding, activeFileId, budget, essentials, { isFirstCall });

  // Record node IDs for delta computation
  const nodeIds = new Set(result.breakdown.map((b) => b.id));
  _sessionLastNodes.set(sessionId, nodeIds);
  _sessionLastAssemble.set(sessionId, Date.now());
  evictIfNeeded();

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

  // Build response with optional hint
  const responseText = result.contextString;

  // Staleness warning
  let staleWarning = '';
  if (result.staleCount > 0) {
    staleWarning = `\n[eidos] Warning: ${result.staleCount} context items may be stale (file changed on disk). Consider: eidos index .`;
  }

  // Build enriched hint for first call after full index
  let hint = result.hint;
  if (didIndex && indexResult) {
    hint = `Project fully indexed: ${indexResult.node_count} nodes, ${indexResult.chunk_count} chunks, ${indexResult.file_count} files. Use search_memory for semantic code search — faster and more precise than grep.`;
  }

  return {
    content: [{
      type: 'text',
      text: responseText + staleWarning,
    }],
    _meta: {
      tokens: result.tokens,
      tokens_saved: result.tokensSaved,
      budget_used: budget,
      intent: budgetEstimate.intent,
      intent_confidence: budgetEstimate.confidence,
      budget_reason: budgetEstimate.reason,
      breakdown: result.breakdown,
      precision: result.precision,
      stale_count: result.staleCount,
      hint,
      is_first_call: isFirstCall,
      did_full_index: didIndex,
      index_stats: didIndex ? {
        nodes: indexResult!.node_count,
        chunks: indexResult!.chunk_count,
        files: indexResult!.file_count,
        duration_ms: indexResult!.duration_ms,
      } : undefined,
    },
  };
}

/**
 * Called after a search_memory or assemble_context call to detect
 * if the AI is re-searching (implicit negative feedback).
 */
export function recordReSearchSignal(sessionId: string): void {
  const lastAssemble = _sessionLastAssemble.get(sessionId);
  if (!lastAssemble) return;
  const elapsed = Date.now() - lastAssemble;
  // If the AI calls search_memory within 30s of receiving context, the context was insufficient
  if (elapsed < 30_000) {
    recordImplicitFeedback(sessionId, 2, 'implicit_research');
  }
}

/**
 * Calculate context precision by checking if the AI's response
 * references items from the injected context.
 */
export function calculatePrecision(sessionId: string, aiResponse: string): number {
  const nodeIds = _sessionLastNodes.get(sessionId);
  if (!nodeIds || nodeIds.size === 0) return 0;

  const db = getDb();
  let matched = 0;
  let total = 0;

  for (const nodeId of nodeIds) {
    const node = db.prepare('SELECT properties FROM nodes WHERE id = ?').get(nodeId) as { properties: string } | undefined;
    if (!node) continue;
    total++;
    try {
      const props = JSON.parse(node.properties) as Record<string, unknown>;
      // Check if any key identifier from the node appears in the AI response
      const identifiers = [
        props['name'] as string,
        props['signature'] as string,
        ...(props['calls'] as string[] ?? []),
      ].filter(Boolean);

      if (identifiers.some(id => id.length > 3 && aiResponse.includes(id))) {
        matched++;
      }
    } catch { /* skip */ }
  }

  return total > 0 ? Math.round((matched / total) * 100) : 0;
}
