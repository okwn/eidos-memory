import { getDb } from '../../store/db.js';
import { getNode } from '../../store/nodes.js';
import { getEdgesFrom, getEdgesTo } from '../../store/edges.js';

/**
 * Get full details of a specific observation/memory node.
 * Returns the complete node properties, linked nodes, and metadata.
 */
export async function handleGetObservation(params: Record<string, unknown>) {
  const db = getDb();
  const nodeId = String(params['id'] ?? '');
  const includeLinks = params['include_links'] !== false; // default true

  if (!nodeId) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: id' }) }],
      isError: true,
    };
  }

  const node = getNode(db, nodeId);
  if (!node) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Node not found: ${nodeId}` }) }],
      isError: true,
    };
  }

  const props = node.properties as Record<string, unknown>;

  // Strip private content from response
  const cleanProps = { ...props };
  if (cleanProps['has_private']) {
    cleanProps['content'] = '[private content excluded]';
    cleanProps['narrative'] = '[private content excluded]';
  }

  const result: Record<string, unknown> = {
    id: node.id,
    type: node.type,
    properties: cleanProps,
    importance: node.importance,
    created_at: node.created_at,
    updated_at: node.updated_at,
    last_accessed: node.last_accessed,
  };

  if (includeLinks) {
    // Get outgoing edges (what this node links to)
    const outgoing = getEdgesFrom(db, nodeId);
    result['links_to'] = outgoing.map((e) => ({
      id: e.target_id,
      rel_type: e.rel_type,
      weight: e.weight,
    }));

    // Get incoming edges (what links to this node)
    const incoming = getEdgesTo(db, nodeId);
    result['linked_from'] = incoming.map((e) => ({
      id: e.source_id,
      rel_type: e.rel_type,
      weight: e.weight,
    }));
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
