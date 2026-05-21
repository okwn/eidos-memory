import { getDb } from '../../store/db.js';

/**
 * List recent memories without a search query.
 * Returns a chronological view of recent observations, decisions, and conversations.
 */
export async function handleListRecent(params: Record<string, unknown>) {
  const db = getDb();
  const limit = Number(params['limit'] ?? 20);
  const type = params['type'] ? String(params['type']) : null;
  const since = params['since'] ? Number(params['since']) : Date.now() - 86400000; // default: last 24h

  let query = `
    SELECT id, type, properties, importance, created_at, updated_at
    FROM nodes
    WHERE created_at > ?
  `;
  const queryParams: unknown[] = [since];

  if (type) {
    query += ` AND type = ?`;
    queryParams.push(type);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  queryParams.push(limit);

  const nodes = db.prepare(query).all(...queryParams) as Array<{
    id: string;
    type: string;
    properties: string;
    importance: number;
    created_at: number;
    updated_at: number;
  }>;

  const items = nodes.map((n) => {
    const props = JSON.parse(n.properties) as Record<string, unknown>;
    return {
      id: n.id,
      type: n.type,
      title: props['title'] ?? props['statement'] ?? props['micro_summary'] ?? n.id,
      preview: (props['narrative'] ?? props['statement'] ?? props['content'] ?? '').toString().slice(0, 150),
      facts: props['facts'] ?? [],
      files_read: props['files_read'] ?? [],
      files_modified: props['files_modified'] ?? [],
      platform: props['platform'] ?? null,
      session_id: props['session_id'] ?? null,
      importance: n.importance,
      created_at: n.created_at,
    };
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ items, count: items.length, since, type }),
    }],
  };
}
