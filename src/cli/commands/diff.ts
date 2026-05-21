import fs from 'fs';
import path from 'path';
import { getDb, getProjectRoot, getEidosDir } from '../../store/db.js';
import { c } from '../spinner.js';

export async function diffCommand(): Promise<void> {
  const projectRoot = getProjectRoot();
  const eidosDir = getEidosDir();
  const dbPath = path.join(eidosDir, 'memory.db');

  if (!fs.existsSync(dbPath)) {
    console.log(`[eidos] No memory found for ${projectRoot}. Run: eidos index .`);
    return;
  }

  const db = getDb();

  // Find the most recent meso_block to determine "last session"
  const recentMeso = db.prepare(
    "SELECT created_at FROM nodes WHERE type = 'meso_block' ORDER BY created_at DESC LIMIT 1"
  ).get() as { created_at: number } | undefined;

  const cutoff = recentMeso?.created_at ?? (Date.now() - 86400000); // fallback: last 24h
  const cutoffDate = new Date(cutoff);

  console.log('');
  console.log(c.bold(c.cyan('  ⚡ EidosCore Memory Diff')));
  console.log(c.dim(`  Changes since ${cutoffDate.toLocaleString()}`));
  console.log(c.dim('  ─────────────────────────────────────'));

  // New conversation turns since last session
  const newTurns = db.prepare(
    "SELECT COUNT(*) as cnt FROM nodes WHERE type = 'conversation_turn' AND created_at > ?"
  ).get(cutoff) as { cnt: number };

  // New decisions
  const newDecisions = db.prepare(
    "SELECT COUNT(*) as cnt FROM nodes WHERE type = 'decision' AND created_at > ?"
  ).get(cutoff) as { cnt: number };

  // New files indexed
  const newFiles = db.prepare(
    "SELECT COUNT(*) as cnt FROM nodes WHERE type = 'file' AND created_at > ?"
  ).get(cutoff) as { cnt: number };

  // Updated files (files that have VERSION_OF edges after cutoff)
  const updatedFiles = db.prepare(
    "SELECT COUNT(DISTINCT source_id) as cnt FROM edges WHERE rel_type = 'VERSION_OF' AND source_id IN (SELECT id FROM nodes WHERE updated_at > ?)"
  ).get(cutoff) as { cnt: number };

  // New errors
  const newErrors = db.prepare(
    "SELECT COUNT(*) as cnt FROM nodes WHERE type = 'error_memory' AND created_at > ?"
  ).get(cutoff) as { cnt: number };

  const row = (label: string, val: number, icon: string) => {
    if (val === 0) return;
    const colour = icon === '+' ? c.green : icon === '!' ? c.yellow : c.cyan;
    console.log(`  ${colour(icon)} ${label.padEnd(24)} ${c.bold(String(val))}`);
  };

  let hasChanges = false;
  if (newFiles.cnt > 0)      { row('New files indexed', newFiles.cnt, '+'); hasChanges = true; }
  if (updatedFiles.cnt > 0)  { row('Files updated', updatedFiles.cnt, '~'); hasChanges = true; }
  if (newTurns.cnt > 0)      { row('Conversation turns', newTurns.cnt, '+'); hasChanges = true; }
  if (newDecisions.cnt > 0)  { row('Decisions recorded', newDecisions.cnt, '+'); hasChanges = true; }
  if (newErrors.cnt > 0)     { row('Errors captured', newErrors.cnt, '!'); hasChanges = true; }

  if (!hasChanges) {
    console.log(c.dim('  No changes since last session.'));
  }

  // Show recent decisions
  const recentDecisions = db.prepare(
    "SELECT properties FROM nodes WHERE type = 'decision' AND created_at > ? ORDER BY created_at DESC LIMIT 5"
  ).all(cutoff) as Array<{ properties: string }>;

  if (recentDecisions.length > 0) {
    console.log('');
    console.log(c.bold('  Recent decisions:'));
    for (const d of recentDecisions) {
      try {
        const props = JSON.parse(d.properties) as Record<string, unknown>;
        const statement = String(props['statement'] ?? '').slice(0, 80);
        console.log(`    ${c.dim('•')} ${statement}`);
      } catch { /* skip */ }
    }
  }

  console.log('');
}
