import Database from 'better-sqlite3';

const DECAY_LAMBDA = 0.05;       // e^(-0.05 * days)
const COLD_THRESHOLD = 0.01;     // importance_live < 0.01 → cold archive
const COLD_AGE_DAYS  = 90;       // only consider nodes older than 90 days

interface NodeDecayRow {
  id: string;
  importance: number;
  last_accessed: number;
  updated_at: number;
}

export interface DecayReport {
  processed: number;
  decayed: number;
  archived: number;
}

export function runDecayPass(db: Database.Database): DecayReport {
  const now = Date.now();
  const msPerDay = 86_400_000;

  const rows = db.prepare(`
    SELECT id, importance, last_accessed, updated_at
    FROM nodes
    WHERE type NOT IN ('qms', 'meso_block')
  `).all() as NodeDecayRow[];

  const updateStmt = db.prepare(`
    UPDATE nodes SET importance = ?, updated_at = ? WHERE id = ?
  `);
  const archiveStmt = db.prepare(`
    UPDATE nodes SET properties = json_patch(properties, '{"archived":true}'), updated_at = ? WHERE id = ?
  `);

  let decayed = 0;
  let archived = 0;

  const runAll = db.transaction(() => {
    for (const row of rows) {
      const daysSinceAccess = (now - (row.last_accessed ?? row.updated_at)) / msPerDay;
      const importanceLive  = row.importance * Math.exp(-DECAY_LAMBDA * daysSinceAccess);

      if (Math.abs(importanceLive - row.importance) < 0.001) continue; // no meaningful change

      updateStmt.run(importanceLive, now, row.id);
      decayed++;

      if (importanceLive < COLD_THRESHOLD && daysSinceAccess > COLD_AGE_DAYS) {
        archiveStmt.run(now, row.id);
        archived++;
      }
    }
  });

  runAll();

  return { processed: rows.length, decayed, archived };
}
