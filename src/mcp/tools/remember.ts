import { randomUUID } from 'crypto';
import { getDb } from '../../store/db.js';
import { upsertNode, listNodes } from '../../store/nodes.js';
import { upsertEdge } from '../../store/edges.js';
import { insertVec } from '../../store/vector.js';
import { embed } from '../../engine/embedding.js';
import { cosineSimilarity } from '../../store/vector.js';

export async function handleRemember(params: Record<string, unknown>) {
  const db = getDb();
  const statement  = String(params['statement'] ?? '');
  const nodeType   = String(params['type'] ?? 'decision');
  const tags       = Array.isArray(params['tags']) ? params['tags'] as string[] : [];
  const importance = typeof params['importance'] === 'number'
    ? params['importance']
    : nodeType === 'decision' ? 0.9 : 0.7;

  const embedding = await embed(statement);
  const nodeId = `${nodeType}:${randomUUID()}`;

  upsertNode(db, {
    id: nodeId,
    type: nodeType,
    properties: { statement, tags, rationale: null },
    embedding,
    importance,
  });
  insertVec(db, nodeId, embedding);

  // Auto-link to top-3 similar chunks
  const chunks = listNodes(db, 'chunk', 200);
  const scored = chunks
    .filter((n) => n.embedding)
    .map((n) => ({ id: n.id, sim: cosineSimilarity(embedding, n.embedding!) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3);

  const linkedTo: string[] = [];
  for (const { id, sim } of scored) {
    if (sim > 0.3) {
      upsertEdge(db, {
        source_id: nodeId,
        target_id: id,
        rel_type: 'RELATES_TO',
        weight: sim,
        properties: {},
      });
      linkedTo.push(id);
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ node_id: nodeId, linked_to: linkedTo }),
    }],
  };
}
