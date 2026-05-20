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

  const queryEmbedding = await embed(query);
  const candidates = await hybridSearch(db, queryEmbedding, activeFileId, 50);
  const selected = knapsackAssemble(candidates, budget);

  const items = selected.map((c) => ({
    id: c.id,
    type: c.type,
    preview: c.representation.split('\n')[0].slice(0, 200),
    tokens: c.tokens,
    score: Math.round(c.score * 1000) / 1000,
  }));

  const tokensUsed = selected.reduce((s, c) => s + c.tokens, 0);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ items, tokens_used: tokensUsed }),
    }],
  };
}
