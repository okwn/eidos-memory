import { randomUUID } from 'crypto';
import { getDb } from '../../store/db.js';
import { upsertNode, listNodes } from '../../store/nodes.js';
import { upsertEdge } from '../../store/edges.js';
import { insertVec } from '../../store/vector.js';
import { embed } from '../../engine/embedding.js';
import { cosineSimilarity } from '../../store/vector.js';
import { stripPrivateTags, hasPrivateTags } from '../../engine/privacy.js';

export async function handleRemember(params: Record<string, unknown>) {
  const db = getDb();
  const statement  = String(params['statement'] ?? '');
  const nodeType   = String(params['type'] ?? 'decision');
  const tags       = Array.isArray(params['tags']) ? params['tags'] as string[] : [];
  const sessionId  = String(params['session_id'] ?? 'default');
  const importance = typeof params['importance'] === 'number'
    ? params['importance']
    : nodeType === 'decision' ? 0.9 : 0.7;

  // Optional structured fields (Claude Mem-inspired)
  const title      = params['title'] ? String(params['title']) : statement.slice(0, 80);
  const narrative  = params['narrative'] ? String(params['narrative']) : '';
  const facts      = Array.isArray(params['facts']) ? params['facts'] as string[] : [];
  const filesRead  = Array.isArray(params['files_read']) ? params['files_read'] as string[] : [];
  const filesModified = Array.isArray(params['files_modified']) ? params['files_modified'] as string[] : [];

  // Strip private tags before storing
  const cleanStatement = stripPrivateTags(statement);
  const cleanNarrative = stripPrivateTags(narrative);

  // Dedup: check if an identical statement already exists
  const existing = db.prepare(
    "SELECT id FROM nodes WHERE json_extract(properties, '$.statement') = ? AND type = ? LIMIT 1"
  ).get(cleanStatement, nodeType) as { id: string } | undefined;
  if (existing) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ node_id: existing.id, linked_to: [], duplicate: true }),
      }],
    };
  }

  const embedding = await embed(cleanStatement);
  const nodeId = `${nodeType}:${randomUUID()}`;

  upsertNode(db, {
    id: nodeId,
    type: nodeType,
    properties: {
      statement: cleanStatement,
      title,
      narrative: cleanNarrative,
      facts,
      files_read: filesRead,
      files_modified: filesModified,
      tags,
      session_id: sessionId,
      has_private: hasPrivateTags(statement),
    },
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
