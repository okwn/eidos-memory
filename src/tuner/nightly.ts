import { getDb } from '../store/db.js';
import { runNightlyTuner } from './tuner.js';
import { runDecayPass } from '../engine/decay.js';
import { writeAuditEntry } from '../engine/audit.js';

export async function runNightlyJobs(): Promise<void> {
  console.log('[eidos-nightly] Starting nightly jobs...');
  const db = getDb();
  const start = Date.now();

  // 1. SGD weight tuning
  try {
    runNightlyTuner();
  } catch (err) {
    console.error('[eidos-nightly] Tuner failed:', err);
  }

  // 2. Memory decay pass
  let decayReport = { processed: 0, decayed: 0, archived: 0 };
  try {
    decayReport = runDecayPass(db);
    console.log(
      `[eidos-nightly] Decay: processed=${decayReport.processed} decayed=${decayReport.decayed} archived=${decayReport.archived}`,
    );
  } catch (err) {
    console.error('[eidos-nightly] Decay pass failed:', err);
  }

  // 3. Audit log entry
  writeAuditEntry({
    ts: Date.now(),
    event: 'context_assembled',
    detail: `nightly: tuner=done decay processed=${decayReport.processed} archived=${decayReport.archived} elapsed=${Date.now() - start}ms`,
  });

  console.log(`[eidos-nightly] Done in ${Date.now() - start}ms.`);
}

// Allow running directly: node dist/tuner/nightly.js
const isMain = process.argv[1]?.endsWith('nightly.js') || process.argv[1]?.endsWith('nightly.ts');
if (isMain) {
  runNightlyJobs().catch((e) => {
    console.error('[eidos-nightly] Fatal:', e);
    process.exit(1);
  });
}
