import fs from 'fs';
import path from 'path';
import { getDb, getLifetimeSavings, getEidosDir, getProjectRoot } from '../../store/db.js';
import { countNodes } from '../../store/nodes.js';
import { c } from '../spinner.js';

export async function statusCommand(): Promise<void> {
  const projectRoot = getProjectRoot();
  const eidosDir = getEidosDir();
  const dbPath = path.join(eidosDir, 'memory.db');

  console.log('');
  console.log(c.bold(c.cyan('  ⚡ EidosCore Status')));
  console.log(c.dim('  ─────────────────────────────────────'));
  console.log(`  ${c.dim('Project:')}     ${c.bold(projectRoot)}`);
  console.log(`  ${c.dim('Memory dir:')}  ${eidosDir}`);

  if (!fs.existsSync(dbPath)) {
    console.log(`  ${c.yellow('Status:')}      Not indexed yet`);
    console.log(`  ${c.dim('Run:')}          eidos index ${projectRoot}`);
    console.log('');
    return;
  }

  const db = getDb();
  const totalNodes    = countNodes(db);
  const chunkNodes    = countNodes(db, 'chunk');
  const fileNodes     = countNodes(db, 'file');
  const turnNodes     = countNodes(db, 'conversation_turn');
  const decisionNodes = countNodes(db, 'decision');
  const qmsNodes      = countNodes(db, 'qms');
  const lifetime      = getLifetimeSavings(db);

  // Check staleness: how many files changed since last index
  const lastIndexed = db.prepare('SELECT MAX(updated_at) as ts FROM nodes WHERE type = ?').get('file') as { ts: number } | undefined;
  const lastDate = lastIndexed?.ts ? new Date(lastIndexed.ts) : null;
  const daysSince = lastDate ? Math.floor((Date.now() - lastDate.getTime()) / 86400000) : -1;

  const row = (label: string, val: string | number, colour?: (s: string) => string) => {
    const v = colour ? colour(String(val)) : String(val);
    return `  ${c.dim(label.padEnd(20))} ${c.bold(v)}`;
  };

  console.log(`  ${c.green('Status:')}      Active`);
  console.log(c.dim('  ─────────────────────────────────────'));
  console.log(row('Total nodes', totalNodes));
  console.log(row('Files indexed', fileNodes));
  console.log(row('Code chunks', chunkNodes));
  console.log(row('Conversations', turnNodes));
  console.log(row('Decisions', decisionNodes));
  console.log(row('QMS snapshots', qmsNodes));

  if (lastDate) {
    console.log(c.dim('  ─────────────────────────────────────'));
    console.log(row('Last indexed', `${lastDate.toLocaleDateString()} (${daysSince}d ago)`));
    if (daysSince > 7) {
      console.log(`  ${c.yellow('⚠')}  Memory may be stale. Consider: ${c.cyan('eidos index .')}`);
    }
  }

  if (lifetime.tokens_saved > 0) {
    console.log(c.dim('  ─────────────────────────────────────'));
    console.log(row('Tokens saved', lifetime.tokens_saved.toLocaleString(), c.green));
    console.log(row('$ saved', `$${lifetime.dollars_saved.toFixed(4)}`, c.green));
    console.log(row('Prompts wrapped', lifetime.prompts_count, c.green));
  }

  // Show .eidos size
  let totalSize = 0;
  try {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else totalSize += fs.statSync(full).size;
      }
    };
    walk(eidosDir);
  } catch { /* ignore */ }
  const sizeStr = totalSize > 1048576 ? `${(totalSize / 1048576).toFixed(1)} MB` : `${(totalSize / 1024).toFixed(0)} KB`;
  console.log(c.dim('  ─────────────────────────────────────'));
  console.log(row('Disk usage', sizeStr));

  console.log('');
}
