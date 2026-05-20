import { getDb } from '../../store/db.js';
import { getEdgesFrom } from '../../store/edges.js';
import { touchNode, getNode } from '../../store/nodes.js';

// Simple in-memory warm cache: just touches nodes so recency boost applies
const _warmCache = new Map<string, number>();

export async function handlePrefetch(params: Record<string, unknown>) {
  const db = getDb();
  const signal   = String(params['signal'] ?? 'file_open');
  const fileUri  = String(params['file_uri'] ?? '');
  const fileId   = `file:${fileUri}`;

  let warmedCount = 0;

  const fileNode = getNode(db, fileId);
  if (!fileNode) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ warmed_items_count: 0 }) }],
    };
  }

  // Touch the file node itself
  touchNode(db, fileId);
  _warmCache.set(fileId, Date.now());
  warmedCount++;

  // Touch all CONTAINS children (chunks)
  const chunks = getEdgesFrom(db, fileId, 'CONTAINS');
  for (const edge of chunks) {
    touchNode(db, edge.target_id);
    _warmCache.set(edge.target_id, Date.now());
    warmedCount++;
  }

  if (signal === 'build_error') {
    // Also warm up error_memory nodes
    const errorNodes = db.prepare(`SELECT id FROM nodes WHERE type = 'error_memory' ORDER BY last_accessed DESC LIMIT 10`).all() as Array<{ id: string }>;
    for (const row of errorNodes) {
      touchNode(db, row.id);
      warmedCount++;
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ warmed_items_count: warmedCount, signal }),
    }],
  };
}
