import { getDb, getLifetimeSavings } from '../store/db.js';
import { countNodes } from '../store/nodes.js';
import { c } from './spinner.js';

export async function statsCommand(opts: { debug?: boolean } = {}): Promise<void> {
  const db = getDb();

  const totalNodes    = countNodes(db);
  const chunkNodes    = countNodes(db, 'chunk');
  const fileNodes     = countNodes(db, 'file');
  const turnNodes     = countNodes(db, 'conversation_turn');
  const mesoNodes     = countNodes(db, 'meso_block');
  const decisionNodes = countNodes(db, 'decision');
  const errorNodes    = countNodes(db, 'error_memory');

  const totalFeedback = (db.prepare(`SELECT COUNT(*) as cnt FROM feedback`).get() as { cnt: number }).cnt;
  const avgScore = totalFeedback > 0
    ? ((db.prepare(`SELECT AVG(score) as avg FROM feedback`).get() as { avg: number }).avg ?? 0).toFixed(2)
    : 'N/A';

  const sessionTokensSaved = parseInt(process.env['EIDOS_TOKENS_SAVED'] ?? '0', 10);
  const costPer1k = parseFloat(process.env['EIDOS_MODEL_COST'] ?? '0.015');
  const dollarsSaved = (sessionTokensSaved / 1000) * costPer1k;

  const row = (label: string, val: string | number, colour?: (s: string) => string) => {
    const v = colour ? colour(String(val)) : String(val);
    return `  ${c.dim(label.padEnd(24))} ${c.bold(v)}`;
  };

  console.log('');
  console.log(c.bold(c.cyan('  ⚡ EidosCore Memory Stats')));
  console.log(c.dim('  ─────────────────────────────────────'));
  console.log(row('Total nodes',         totalNodes));
  console.log(row('Code chunks',         chunkNodes));
  console.log(row('Files indexed',       fileNodes));
  console.log(row('Conversation turns',  turnNodes));
  console.log(row('Meso blocks',         mesoNodes));
  console.log(row('Decisions stored',    decisionNodes));
  console.log(row('Error memories',      errorNodes));
  console.log(c.dim('  ─────────────────────────────────────'));
  console.log(row('Avg feedback score',  avgScore));
  console.log(row('Session tokens saved', sessionTokensSaved, c.green));
  console.log(row('Session $ saved',     `$${dollarsSaved.toFixed(4)}`, c.green));
  console.log('');

  if (sessionTokensSaved > 0) {
    console.log(c.green(c.bold(
      `  ✔ Saved ~${sessionTokensSaved.toLocaleString()} tokens (~$${dollarsSaved.toFixed(4)}) this session.`
    )));
    console.log('');
  }

  // Lifetime savings from DB — always shown so user can verify persistence
  const lifetime = getLifetimeSavings(db);
  console.log(c.bold(c.cyan('  📊 Lifetime Savings (persistent)')));
  console.log(c.dim('  ─────────────────────────────────────'));
  console.log(row('Total prompts wrapped', lifetime.prompts_count, lifetime.prompts_count > 0 ? c.green : undefined));
  console.log(row('Total tokens saved',    lifetime.tokens_saved,  lifetime.tokens_saved > 0  ? c.green : undefined));
  console.log(row('Total $ saved',         `$${lifetime.dollars_saved.toFixed(4)}`, lifetime.dollars_saved > 0 ? c.green : undefined));
  const avgPerPrompt = lifetime.prompts_count > 0
    ? Math.round(lifetime.tokens_saved / lifetime.prompts_count) : 0;
  console.log(row('Avg tokens/prompt',     avgPerPrompt));
  console.log('');

  if (opts.debug) {
    // Debug: show raw DB path and table contents for verification
    const { getDbPath } = await import('../store/db.js');
    const dbPath = getDbPath();
    console.log(c.dim(`  [debug] DB: ${dbPath}`));
    const raw = db.prepare(`SELECT * FROM lifetime_savings WHERE id = 1`).get() as Record<string, unknown> | undefined;
    console.log(c.dim(`  [debug] lifetime_savings row: ${JSON.stringify(raw)}`));
    const turnCount = db.prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE type='conversation_turn'`).get() as { cnt: number };
    console.log(c.dim(`  [debug] conversation_turn nodes in DB: ${turnCount.cnt}`));
    console.log('');
  }

  if (lifetime.prompts_count === 0 && sessionTokensSaved === 0) {
    console.log(c.dim('  Run: eidos wrap <cli> "your question"  to start saving tokens.'));
    console.log('');
  }
}
