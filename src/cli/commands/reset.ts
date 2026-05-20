import { getDb } from '../../store/db.js';
import readline from 'readline';

export async function resetWorkspace(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question('[eidos] WARNING: This will permanently delete workspace memory. Are you sure? [y/N] ', (answer: string) => {
      rl.close();
      if (answer.toLowerCase() === 'y') {
        const db = getDb();
        db.exec('DELETE FROM edges');
        db.exec('DELETE FROM nodes');
        try { db.exec('DELETE FROM vec_nodes'); } catch { /* vss may not be loaded */ }
        console.log('[eidos] Workspace memory cleared.');
      } else {
        console.log('[eidos] Aborted.');
      }
      resolve();
    });
  });
}
