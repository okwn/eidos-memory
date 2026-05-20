import { getDb } from '../../store/db.js';
import { getNode, touchNode } from '../../store/nodes.js';
import { searchVec } from '../../store/vector.js';

export async function handleLoadQms(params: Record<string, unknown>) {
  const db = getDb();
  const qmsId = String(params['qms_id'] ?? '');

  const qmsNode = getNode(db, qmsId);
  if (!qmsNode) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'QMS not found' }) }],
      isError: true,
    };
  }

  const props = qmsNode.properties as Record<string, unknown>;
  const top50Ids = Array.isArray(props['top50_node_ids']) ? props['top50_node_ids'] as string[] : [];

  let primedCount = 0;

  // Touch top-50 directly known nodes
  for (const nodeId of top50Ids) {
    const n = getNode(db, nodeId);
    if (n) {
      touchNode(db, nodeId);
      primedCount++;
    }
  }

  // ANN search with QMS vector → add 50 more
  if (qmsNode.embedding) {
    const results = searchVec(db, qmsNode.embedding, 50);
    for (const r of results) {
      if (!top50Ids.includes(r.id)) {
        touchNode(db, r.id);
        primedCount++;
      }
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ primed_nodes_count: primedCount, qms_id: qmsId }),
    }],
  };
}
