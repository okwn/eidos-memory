import Database from 'better-sqlite3';
import fs from 'fs';
import { searchVec } from '../store/vector.js';
import { getNode, touchNode } from '../store/nodes.js';
import { getNeighbourIds, getEdgesFrom } from '../store/edges.js';
import { getWeights, DEFAULT_WEIGHTS } from '../store/db.js';
import { countTokens } from './tokens.js';

export interface RetrievalCandidate {
  id: string;
  type: string;
  representation: string; // skeleton or full body or summary
  tokens: number;
  score: number;
  cosineSim: number;
  graphBoost: number;
  recencyBoost: number;
  astBoost: number;
  stale: boolean;
}

export interface AssembledContext {
  contextString: string;
  tokens: number;
  breakdown: Array<{ id: string; type: string; tokens: number; score: number }>;
  tokensSaved: number;
  precision: number;
  staleCount: number;
  hint: string | null;
}

const RECENCY_LAMBDA = 0.05; // half-life ~14h

function recencyBoost(lastAccessed: number): number {
  const hoursAgo = (Date.now() - lastAccessed) / (1000 * 60 * 60);
  return Math.exp(-RECENCY_LAMBDA * hoursAgo);
}

function graphBoostScore(hops: number): number {
  return 1 + 0.3 / Math.max(hops, 1);
}

/**
 * Extract identifiers (function names, class names, etc.) from a query string.
 * These are used for AST-aware scoring — if a query mentions "handleLogin",
 * nodes whose skeleton contains "handleLogin" should rank higher.
 */
function extractQueryIdentifiers(query: string): Set<string> {
  const ids = new Set<string>();
  // Match camelCase, snake_case, PascalCase identifiers (2+ chars)
  const matches = query.match(/\b[a-zA-Z_][a-zA-Z0-9_]{1,}\b/g);
  if (!matches) return ids;
  const STOP_WORDS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has',
    'how', 'what', 'when', 'where', 'why', 'which', 'who', 'will', 'with',
    'this', 'that', 'from', 'into', 'about', 'should', 'could', 'would',
    'does', 'did', 'been', 'being', 'were', 'was', 'their', 'there',
    'they', 'them', 'then', 'than', 'some', 'these', 'those', 'each',
    'just', 'also', 'very', 'most', 'more', 'such', 'only', 'over',
    'after', 'before', 'between', 'under', 'again', 'same', 'using',
    'file', 'code', 'function', 'class', 'method', 'error', 'bug',
    'fix', 'change', 'update', 'add', 'remove', 'new', 'old',
  ]);
  for (const m of matches) {
    const lower = m.toLowerCase();
    if (STOP_WORDS.has(lower)) continue;
    if (m.length < 3) continue;
    ids.add(m);
    ids.add(lower); // also add lowercase for case-insensitive matching
  }
  return ids;
}

/**
 * AST-aware boost: if the query mentions a function/class name that appears
 * in a node's skeleton or properties, boost the score.
 */
function astBoostScore(props: Record<string, unknown>, queryIds: Set<string>): number {
  if (queryIds.size === 0) return 0;
  const text = [
    props['skeleton'] as string ?? '',
    props['signature'] as string ?? '',
    props['statement'] as string ?? '',
    (props['calls'] as string[] ?? []).join(' '),
    props['name'] as string ?? '',
  ].join(' ').toLowerCase();

  let matches = 0;
  for (const id of queryIds) {
    if (text.includes(id)) matches++;
  }
  return matches > 0 ? Math.min(1, matches * 0.3) : 0;
}

/**
 * Check if a file node is stale (file on disk is newer than the indexed version).
 * Uses the node's updated_at column (not the JSON properties).
 */
function isNodeStale(props: Record<string, unknown>, nodeUpdatedAt: number): boolean {
  const filePath = props['filePath'] as string ?? props['path'] as string;
  if (!filePath) return false;
  try {
    const stat = fs.statSync(filePath);
    return stat.mtimeMs > nodeUpdatedAt + 1000; // 1s tolerance for filesystem precision
  } catch {
    return false;
  }
}

/**
 * Get file IDs reachable via DEPENDS_ON edges from a starting file.
 * This finds the import graph — files that the active file depends on.
 */
function getImportGraph(db: Database.Database, fileId: string, maxHops = 2): Set<string> {
  const reachable = new Set<string>();
  let frontier = [fileId];
  for (let hop = 1; hop <= maxHops; hop++) {
    const next: string[] = [];
    for (const fid of frontier) {
      const deps = getEdgesFrom(db, fid, 'DEPENDS_ON');
      for (const dep of deps) {
        if (!reachable.has(dep.target_id)) {
          reachable.add(dep.target_id);
          next.push(dep.target_id);
        }
      }
    }
    frontier = next;
  }
  return reachable;
}

export async function hybridSearch(
  db: Database.Database,
  queryEmbedding: Float32Array,
  activeFileId: string | null,
  k = 100,
  query = '',
): Promise<RetrievalCandidate[]> {
  const weights = getWeights(db);
  const alpha   = weights['alpha']   ?? DEFAULT_WEIGHTS.alpha;
  const beta    = weights['beta']    ?? DEFAULT_WEIGHTS.beta;
  const gamma   = weights['gamma']   ?? DEFAULT_WEIGHTS.gamma;
  const delta   = weights['delta']   ?? DEFAULT_WEIGHTS.delta;

  // Step 0: Extract query identifiers for AST-aware scoring
  const queryIds = extractQueryIdentifiers(query);

  // Step 1: ANN search
  const vecResults = searchVec(db, queryEmbedding, k);

  // Step 2: Neighbourhood map from active file (BFS on all edges)
  const neighbourMap = activeFileId
    ? getNeighbourIds(db, activeFileId, 2)
    : new Map<string, number>();

  // Step 3: Import graph from active file (DEPENDS_ON edges only)
  const importSet = activeFileId
    ? getImportGraph(db, activeFileId, 2)
    : new Set<string>();

  const candidates: RetrievalCandidate[] = [];

  for (const { id, distance } of vecResults) {
    const node = getNode(db, id);
    if (!node) continue;

    // Skip archived nodes
    const props = node.properties as Record<string, unknown>;
    if (props['archived'] === true) continue;

    // For code chunks, prefer fullBody (actual code) for rich context.
    // For other node types, use skeleton/summary/statement.
    const isChunk = node.type === 'chunk';
    const representation = isChunk
      ? ((props['fullBody'] as string | undefined)
        ?? (props['skeleton'] as string | undefined)
        ?? JSON.stringify(props).slice(0, 200))
      : ((props['skeleton'] as string | undefined)
        ?? (props['summary'] as string | undefined)
        ?? (props['statement'] as string | undefined)
        ?? JSON.stringify(props).slice(0, 200));

    const tokens = countTokens(representation);
    const cosine = Math.max(0, 1 - distance);

    // Graph boost: general neighbourhood
    const hops = neighbourMap.get(id) ?? 99;
    const graph = hops < 99 ? graphBoostScore(hops) : 0;

    // Import graph boost: DEPENDS_ON edges are stronger signal
    const importBoost = importSet.has(id) ? 0.4 : 0;

    // Recency
    const recency = recencyBoost(node.last_accessed);

    // AST-aware boost
    const ast = astBoostScore(props, queryIds);

    // Staleness check — use the DB column updated_at, not the JSON property
    const stale = isNodeStale(props, node.updated_at);

    const tokenCost = tokens / 2000; // normalised

    const score =
      alpha * cosine +
      beta * (graph + importBoost) +
      gamma * recency +
      0.15 * ast -
      delta * tokenCost;

    candidates.push({
      id,
      type: node.type,
      representation,
      tokens,
      score,
      cosineSim: cosine,
      graphBoost: graph + importBoost,
      recencyBoost: recency,
      astBoost: ast,
      stale,
    });

    // epsilon is preserved for the knapsack overlap penalty stage
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export function knapsackAssemble(
  candidates: RetrievalCandidate[],
  budget: number,
  epsilon = 0.10,
): RetrievalCandidate[] {
  // Greedy by score/token ratio; with diversity (overlap) penalty
  const sorted = [...candidates].sort((a, b) => (b.score / b.tokens) - (a.score / a.tokens));
  const selected: RetrievalCandidate[] = [];
  let remaining = budget;

  for (const c of sorted) {
    if (remaining <= 0) break;
    if (c.tokens > remaining) continue;
    selected.push(c);
    remaining -= c.tokens;
    // Apply overlap penalty to remaining candidates (simple representation-length proxy)
    if (epsilon > 0) {
      for (const other of sorted) {
        if (!selected.includes(other)) {
          other.score *= (1 - epsilon * 0.1);
        }
      }
    }
  }

  return selected;
}

export async function assembleContext(
  db: Database.Database,
  query: string,
  queryEmbedding: Float32Array,
  activeFileId: string | null,
  budget: number,
  essentials: Array<{ label: string; content: string }>,
  options?: { isFirstCall?: boolean },
): Promise<AssembledContext> {
  // Reserve tokens for essentials
  const essentialText = essentials.map((e) => `[${e.label}] ${e.content}`).join('\n');
  const essentialTokens = countTokens(essentialText);
  const remainingBudget = Math.max(0, budget - essentialTokens);

  // Search and rank (pass query for AST-aware scoring)
  const candidates = await hybridSearch(db, queryEmbedding, activeFileId, 100, query);

  // Filter out low-importance decayed nodes (importance < 0.05 and not accessed in 30 days)
  const now = Date.now();
  const filtered = candidates.filter((c) => {
    const node = getNode(db, c.id);
    if (!node) return false;
    const daysSinceAccess = (now - node.last_accessed) / 86_400_000;
    if (node.importance < 0.05 && daysSinceAccess > 30) return false;
    return true;
  });

  // Knapsack — load epsilon weight for overlap penalty
  const weights = getWeights(db);
  const epsilon = weights['epsilon'] ?? DEFAULT_WEIGHTS.epsilon;
  const selected = knapsackAssemble(filtered, remainingBudget, epsilon);

  // Touch accessed nodes
  for (const c of selected) touchNode(db, c.id);

  // Count stale nodes
  const staleCount = selected.filter((c) => c.stale).length;

  // Progressive disclosure: fast mode shows titles only, full mode shows everything.
  // Auto-detect based on how many items we have vs budget.
  const totalCandidateTokens = selected.reduce((s, c) => s + c.tokens, 0);
  const fastMode = totalCandidateTokens > remainingBudget * 1.5;

  // Format output
  const contextParts: string[] = [];
  if (essentialText) contextParts.push(essentialText);

  if (selected.length > 0) {
    const codeItems = selected.filter((c) => c.type === 'chunk');
    const memItems = selected.filter((c) => c.type !== 'chunk');

    if (fastMode) {
      // Fast rendering: titles/signatures only (fits more items)
      const codeCtx = codeItems
        .map((c) => {
          const prefix = c.stale ? '[stale] ' : '';
          const firstLine = c.representation.split('\n')[0]?.trim() ?? c.representation.slice(0, 100);
          return `  - ${prefix}${firstLine}`;
        })
        .join('\n');
      if (codeCtx) contextParts.push(`[CODE CONTEXT]\n${codeCtx}`);

      const memCtx = memItems
        .map((c) => {
          const props = (getNode(db, c.id)?.properties ?? {}) as Record<string, unknown>;
          const title = (props['title'] ?? props['statement'] ?? c.representation.split('\n')[0] ?? '').toString().slice(0, 100);
          return `  - [${c.type}] ${title}`;
        })
        .join('\n');
      if (memCtx) contextParts.push(`[MEMORY]\n${memCtx}`);
    } else {
      // Full rendering: complete code + narrative
      const codeCtx = codeItems
        .map((c) => {
          const prefix = c.stale ? '[stale] ' : '';
          const rep = c.representation;
          if (rep.includes('\n') && (rep.includes('{') || rep.includes('function') || rep.includes('class'))) {
            const truncated = rep.length > 800 ? rep.slice(0, 800) + '\n  // ...' : rep;
            return `  ${prefix}${truncated}`;
          }
          const lines = rep.split('\n').filter(l => l.trim());
          const detail = lines.length > 1 ? lines.join('\n    ') : lines[0] ?? rep;
          return `  - ${prefix}${detail}`;
        })
        .join('\n\n');
      if (codeCtx) contextParts.push(`[CODE CONTEXT]\n${codeCtx}`);

      const memCtx = memItems
        .map((c) => {
          const props = (getNode(db, c.id)?.properties ?? {}) as Record<string, unknown>;
          const title = (props['title'] ?? props['statement'] ?? '').toString().slice(0, 80);
          const narrative = (props['narrative'] ?? c.representation ?? '').toString();
          const narrativeShort = narrative.length > 200 ? narrative.slice(0, 200) + '...' : narrative;
          const facts = props['facts'] as string[] ?? [];
          const factsStr = facts.length > 0 ? `\n    Facts: ${facts.join('; ')}` : '';
          return `  - [${c.type}] ${title}\n    ${narrativeShort}${factsStr}`;
        })
        .join('\n');
      if (memCtx) contextParts.push(`[MEMORY]\n${memCtx}`);
    }
  }

  contextParts.push(`[QUERY] ${query}`);

  const contextString = contextParts.join('\n');
  const totalTokens = countTokens(contextString);
  const estimatedFullTokens = candidates.reduce((s, c) => s + c.tokens, 0) + essentialTokens;

  // Pre-prompt hint for first call in session
  const hint = options?.isFirstCall
    ? 'IMPORTANT: Use search_memory before grep for all code questions. Eidos memory is faster and already knows this codebase.'
    : null;

  // Precision: placeholder (will be calculated by caller after AI response)
  const precision = 0;

  return {
    contextString,
    tokens: totalTokens,
    breakdown: selected.map((c) => ({ id: c.id, type: c.type, tokens: c.tokens, score: c.score })),
    tokensSaved: Math.max(0, estimatedFullTokens - totalTokens),
    precision,
    staleCount,
    hint,
  };
}
