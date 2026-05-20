import { getDb } from '../../store/db.js';
import { getNode } from '../../store/nodes.js';
import { getSessionLastNodes } from './assemble_context.js';
import { embed } from '../../engine/embedding.js';
import { hybridSearch, knapsackAssemble } from '../../engine/retrieval.js';

export async function handleGetContextDelta(params: Record<string, unknown>) {
  const db = getDb();
  const sessionId = String(params['session_id'] ?? 'default');

  const lastNodes = getSessionLastNodes(sessionId);

  // Re-run search to find what would be assembled now
  const dummyQuery = 'context update';
  const queryEmbedding = await embed(dummyQuery);
  const candidates = await hybridSearch(db, queryEmbedding, null, 50);
  const selected = knapsackAssemble(candidates, 2000);

  // Return only nodes not in last assembly
  const newNodes = selected.filter((c) => !lastNodes.has(c.id));

  const parts = newNodes.map((c) => {
    const node = getNode(db, c.id);
    const p = (node?.properties ?? {}) as Record<string, unknown>;
    return `[${c.type}] ${String(p['skeleton'] ?? p['statement'] ?? p['micro_summary'] ?? '').split('\n')[0]}`;
  });

  const deltaString = parts.length > 0 ? `[CONTEXT DELTA]\n${parts.join('\n')}` : '[CONTEXT DELTA] No new items.';
  const tokensSaved = (selected.length - newNodes.length) * 30; // rough estimate

  return {
    content: [{
      type: 'text',
      text: deltaString,
    }],
    _meta: { new_items: newNodes.length, tokens_saved: tokensSaved },
  };
}
