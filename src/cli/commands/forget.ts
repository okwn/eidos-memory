import { getDb } from '../../store/db.js';
import { embed } from '../../engine/embedding.js';
import { searchVec } from '../../store/vector.js';
import readline from 'readline';

export async function forgetCommand(query: string): Promise<void> {
  const db = getDb();

  if (!query) {
    console.log('[eidos] Usage: eidos forget <query>');
    console.log('[eidos] Example: eidos forget "use Redux for state management"');
    return;
  }

  // Embed the query and find the most relevant decision/fact nodes
  const queryEmbedding = await embed(query);
  const vecResults = searchVec(db, queryEmbedding, 10);

  // Filter to decision and fact nodes
  const candidates: Array<{ id: string; type: string; statement: string; score: number }> = [];
  for (const { id, distance } of vecResults) {
    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as { id: string; type: string; properties: string } | undefined;
    if (!node) continue;
    if (node.type !== 'decision' && node.type !== 'fact') continue;
    try {
      const props = JSON.parse(node.properties) as Record<string, unknown>;
      const statement = String(props['statement'] ?? props['content'] ?? '').slice(0, 100);
      candidates.push({ id: node.id, type: node.type, statement, score: 1 - distance });
    } catch { /* skip */ }
  }

  if (candidates.length === 0) {
    console.log(`[eidos] No matching decisions or facts found for: "${query}"`);
    return;
  }

  // Show top matches
  console.log(`\n${'\x1b[36m'}[eidos] Found ${candidates.length} matching memories:${'\x1b[0m'}`);
  for (let i = 0; i < Math.min(candidates.length, 5); i++) {
    const c = candidates[i]!;
    console.log(`  ${i + 1}. [${c.type}] ${c.statement} ${'\x1b[2m'}(score: ${c.score.toFixed(2)})${'\x1b[0m'}`);
  }

  // Ask which to forget
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question('\n[eidos] Which to forget? (number, or "all", or "cancel"): ', resolve);
  });
  rl.close();

  if (answer === 'cancel' || !answer) {
    console.log('[eidos] Cancelled.');
    return;
  }

  const toForget = answer === 'all'
    ? candidates
    : [candidates[parseInt(answer, 10) - 1]].filter(Boolean);

  for (const item of toForget) {
    if (!item) continue;
    // Soft-delete: set importance to 0 and mark as archived
    db.prepare(`
      UPDATE nodes SET importance = 0,
        properties = json_patch(properties, '{"archived":true,"forgotten":true}'),
        updated_at = ?
      WHERE id = ?
    `).run(Date.now(), item.id);
    console.log(`  ${'\x1b[33m'}✗${'\x1b[0m'} Forgotten: [${item.type}] ${item.statement}`);
  }

  console.log(`\n[eidos] ${toForget.length} memory/memories forgotten. They will no longer appear in context.`);
}

export async function pruneCommand(): Promise<void> {
  const { runDecayPass } = await import('../../engine/decay.js');
  const db = getDb();

  console.log('\x1b[36m[eidos] Running decay pass...\x1b[0m');
  const report = runDecayPass(db);

  console.log(`  Processed: ${report.processed} nodes`);
  console.log(`  Decayed:   ${report.decayed} nodes (importance reduced)`);
  console.log(`  Archived:  ${report.archived} nodes (cold, moved to archive)`);

  if (report.archived > 0) {
    console.log(`\n  ${'\x1b[33m'}Run eidos index . to refresh the index.${'\x1b[0m'}`);
  }
}
