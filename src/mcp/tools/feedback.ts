import { randomUUID } from 'crypto';
import { getDb } from '../../store/db.js';

export async function handleFeedback(params: Record<string, unknown>) {
  const db = getDb();
  const score     = Number(params['score'] ?? 3);
  const sessionId = String(params['session_id'] ?? 'default');
  const source    = String(params['source'] ?? 'user');

  const clampedScore = Math.max(1, Math.min(5, score));
  const feedbackId = `feedback:${randomUUID()}`;

  db.prepare(`
    INSERT INTO feedback (id, session_id, score, source, created_at, properties)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(feedbackId, sessionId, clampedScore, source, Date.now(), JSON.stringify({}));

  // Check for implicit signal: re-search within 30s
  db.prepare(`
    SELECT created_at FROM feedback
    WHERE session_id = ? AND source = 'implicit_research'
    ORDER BY created_at DESC LIMIT 1
  `).get(sessionId) as { created_at: number } | undefined;

  const weightsUpdated = false; // batch SGD happens nightly via tuner

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ feedback_id: feedbackId, score: clampedScore, weights_updated: weightsUpdated }),
    }],
  };
}

export function recordImplicitFeedback(sessionId: string, score: number, source: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO feedback (id, session_id, score, source, created_at, properties)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`feedback:${randomUUID()}`, sessionId, score, source, Date.now(), JSON.stringify({}));
}
