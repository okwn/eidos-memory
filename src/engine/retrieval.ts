import Database from 'better-sqlite3';
import { searchVec, cosineSimilarity } from '../store/vector.js';
import { getNode, touchNode } from '../store/nodes.js';
import { getNeighbourIds } from '../store/edges.js';
import { getWeights } from '../store/db.js';
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
}

export interface AssembledContext {
  contextString: string;
  tokens: number;
  breakdown: Array<{ id: string; type: string; tokens: number; score: number }>;
  tokensSaved: number;
}

const RECENCY_LAMBDA = 0.05; // half-life ~14h

function recencyBoost(lastAccessed: number): number {
  const hoursAgo = (Date.now() - lastAccessed) / (1000 * 60 * 60);
  return Math.exp(-RECENCY_LAMBDA * hoursAgo);
}

function graphBoostScore(hops: number): number {
  return 1 + 0.3 / Math.max(hops, 1);
}

export async function hybridSearch(
  db: Database.Database,
  queryEmbedding: Float32Array,
  activeFileId: string | null,
  k = 100,
): Promise<RetrievalCandidate[]> {
  const weights = getWeights(db);
  const alpha   = weights['alpha']   ?? 0.6;
  const beta    = weights['beta']    ?? 0.2;
  const gamma   = weights['gamma']   ?? 0.15;
  const delta   = weights['delta']   ?? 0.05;
  const epsilon = weights['epsilon'] ?? 0.10;

  // Step 1: ANN search
  const vecResults = searchVec(db, queryEmbedding, k);

  // Step 2: Neighbourhood map from active file
  const neighbourMap = activeFileId
    ? getNeighbourIds(db, activeFileId, 2)
    : new Map<string, number>();

  const candidates: RetrievalCandidate[] = [];

  for (const { id, distance } of vecResults) {
    const node = getNode(db, id);
    if (!node) continue;

    const props = node.properties as Record<string, unknown>;
    const representation = (props['skeleton'] as string | undefined)
      ?? (props['fullBody'] as string | undefined)
      ?? (props['summary'] as string | undefined)
      ?? (props['statement'] as string | undefined)
      ?? JSON.stringify(props).slice(0, 200);

    const tokens = countTokens(representation);
    const cosine = Math.max(0, 1 - distance);
    const hops = neighbourMap.get(id) ?? 99;
    const graph = hops < 99 ? graphBoostScore(hops) : 0;
    const recency = recencyBoost(node.last_accessed);
    const tokenCost = tokens / 2000; // normalised

    const score =
      alpha * cosine +
      beta * graph +
      gamma * recency -
      delta * tokenCost;

    candidates.push({
      id,
      type: node.type,
      representation,
      tokens,
      score,
      cosineSim: cosine,
      graphBoost: graph,
      recencyBoost: recency,
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
): Promise<AssembledContext> {
  // Reserve tokens for essentials
  const essentialText = essentials.map((e) => `[${e.label}] ${e.content}`).join('\n');
  const essentialTokens = countTokens(essentialText);
  const remainingBudget = Math.max(0, budget - essentialTokens);

  // Search and rank
  const candidates = await hybridSearch(db, queryEmbedding, activeFileId, 100);

  // Knapsack
  const selected = knapsackAssemble(candidates, remainingBudget);

  // Touch accessed nodes
  for (const c of selected) touchNode(db, c.id);

  // Format output
  const contextParts: string[] = [];
  if (essentialText) contextParts.push(essentialText);

  if (selected.length > 0) {
    const codeCtx = selected
      .filter((c) => c.type === 'chunk')
      .map((c) => `  - ${c.representation.split('\n')[0]}`)
      .join('\n');
    if (codeCtx) contextParts.push(`[CODE CONTEXT]\n${codeCtx}`);

    const memCtx = selected
      .filter((c) => c.type !== 'chunk')
      .map((c) => `  - [${c.type}] ${c.representation.split('\n')[0]}`)
      .join('\n');
    if (memCtx) contextParts.push(`[MEMORY]\n${memCtx}`);
  }

  contextParts.push(`[QUERY] ${query}`);

  const contextString = contextParts.join('\n');
  const totalTokens = countTokens(contextString);
  const estimatedFullTokens = candidates.reduce((s, c) => s + c.tokens, 0) + essentialTokens;

  return {
    contextString,
    tokens: totalTokens,
    breakdown: selected.map((c) => ({ id: c.id, type: c.type, tokens: c.tokens, score: c.score })),
    tokensSaved: Math.max(0, estimatedFullTokens - totalTokens),
  };
}
