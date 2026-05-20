import { randomUUID } from 'crypto';
import { getDb } from '../../store/db.js';
import { upsertNode, listNodes } from '../../store/nodes.js';
import { insertVec } from '../../store/vector.js';

export async function handleGenerateQms(params: Record<string, unknown>) {
  const db = getDb();
  const sessionId = String(params['session_id'] ?? 'default');

  // Gather all nodes accessed in this session (recently touched nodes)
  const recentNodes = listNodes(db, undefined, 200).filter((n) => {
    const ageMs = Date.now() - n.last_accessed;
    return ageMs < 24 * 60 * 60 * 1000; // within last 24h
  });

  if (recentNodes.length === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'No session nodes found' }) }],
      isError: true,
    };
  }

  // Weight each node by importance × recency
  const lambda = 0.05;
  const now = Date.now();
  const weighted = recentNodes
    .filter((n) => n.embedding)
    .map((n) => {
      const hoursAgo = (now - n.last_accessed) / (1000 * 60 * 60);
      const recency = Math.exp(-lambda * hoursAgo);
      const weight = n.importance * recency;
      return { node: n, weight };
    })
    .sort((a, b) => b.weight - a.weight);

  // Top-50 node IDs
  const top50 = weighted.slice(0, 50).map((w) => w.node.id);

  // Weighted mean embedding (384d)
  const dim = 384;
  const meanEmbed = new Float32Array(dim);
  let totalWeight = 0;

  for (const { node, weight } of weighted.slice(0, 50)) {
    if (!node.embedding) continue;
    totalWeight += weight;
    for (let i = 0; i < dim; i++) {
      meanEmbed[i] += node.embedding[i] * weight;
    }
  }
  if (totalWeight > 0) {
    for (let i = 0; i < dim; i++) meanEmbed[i] /= totalWeight;
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += meanEmbed[i] * meanEmbed[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) meanEmbed[i] /= norm;

  const qmsId = `qms:${sessionId}:${randomUUID()}`;
  upsertNode(db, {
    id: qmsId,
    type: 'qms',
    properties: { session_id: sessionId, top50_node_ids: top50, created_at: now },
    embedding: meanEmbed,
    importance: 0.9,
  });
  insertVec(db, qmsId, meanEmbed);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        qms_id: qmsId,
        top50_count: top50.length,
        vector_preview: Array.from(meanEmbed.slice(0, 4)).map((v) => Math.round(v * 1000) / 1000),
      }),
    }],
  };
}
