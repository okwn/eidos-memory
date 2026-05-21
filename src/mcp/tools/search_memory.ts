import { getDb } from '../../store/db.js';
import { embed } from '../../engine/embedding.js';
import { hybridSearch, knapsackAssemble } from '../../engine/retrieval.js';
import { countTokens } from '../../engine/tokens.js';

export async function handleSearchMemory(params: Record<string, unknown>) {
  const db = getDb();
  const query = String(params['query'] ?? '');
  const budget = Number(params['budget_tokens'] ?? 2000);
  const activeFile = params['active_file'] ? String(params['active_file']) : null;
  const activeFileId = activeFile ? `file:${activeFile}` : null;
  const mode = String(params['mode'] ?? 'semantic'); // 'semantic' | 'timeline' | 'recent'

  let items: Array<Record<string, unknown>> = [];
  let tokensUsed = 0;

  if (mode === 'timeline' || mode === 'recent') {
    // Timeline mode: chronological view of observations and summaries
    const limit = Number(params['limit'] ?? 20);
    const since = params['since'] ? Number(params['since']) : Date.now() - 86400000; // default: last 24h

    const nodes = db.prepare(`
      SELECT id, type, properties, importance, created_at, updated_at
      FROM nodes
      WHERE type IN ('decision', 'fact', 'conversation_turn', 'meso_block', 'observation')
        AND created_at > ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(since, limit) as Array<{ id: string; type: string; properties: string; importance: number; created_at: number }>;

    items = nodes.map((n) => {
      const props = JSON.parse(n.properties) as Record<string, unknown>;
      return {
        id: n.id,
        type: n.type,
        title: props['title'] ?? props['statement'] ?? props['micro_summary'] ?? '',
        preview: (props['narrative'] ?? props['statement'] ?? props['content'] ?? '').toString().slice(0, 200),
        facts: props['facts'] ?? [],
        files_read: props['files_read'] ?? [],
        files_modified: props['files_modified'] ?? [],
        created_at: n.created_at,
        importance: n.importance,
      };
    });

    tokensUsed = items.reduce((s, i) => s + countTokens(String(i['preview'])), 0);
  } else {
    // Semantic mode: hybrid search with vector + graph
    const queryEmbedding = await embed(query);
    const candidates = await hybridSearch(db, queryEmbedding, activeFileId, 50, query);
    const selected = knapsackAssemble(candidates, budget);

    items = selected.map((c) => {
      const node = db.prepare('SELECT properties, created_at FROM nodes WHERE id = ?').get(c.id) as { properties: string; created_at: number } | undefined;
      const props = node ? (JSON.parse(node.properties) as Record<string, unknown>) : {};
      return {
        id: c.id,
        type: c.type,
        title: props['title'] ?? props['statement'] ?? c.representation.split('\n')[0].slice(0, 80),
        preview: c.representation.split('\n').slice(0, 3).join(' ').slice(0, 200),
        facts: props['facts'] ?? [],
        files_read: props['files_read'] ?? [],
        files_modified: props['files_modified'] ?? [],
        score: Math.round(c.score * 1000) / 1000,
        tokens: c.tokens,
        created_at: node?.created_at,
      };
    });

    tokensUsed = selected.reduce((s, c) => s + c.tokens, 0);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ items, tokens_used: tokensUsed, mode }),
    }],
  };
}
