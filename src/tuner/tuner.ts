import { getDb, getWeights } from '../store/db.js';

interface FeedbackRow {
  score: number;
  properties: string;
}

export function runNightlyTuner(): void {
  const db = getDb();
  const lr = 0.01;
  const minW = 0.05;
  const maxW = 0.95;

  // Fetch last 100 feedback samples
  const samples = db.prepare(`
    SELECT score, properties FROM feedback ORDER BY created_at DESC LIMIT 100
  `).all() as FeedbackRow[];

  if (samples.length < 10) {
    console.log('[eidos-tuner] Not enough feedback samples yet (need ≥10).');
    return;
  }

  const weights = getWeights(db);
  let alpha   = weights['alpha']   ?? 0.6;
  let beta    = weights['beta']    ?? 0.2;
  let gamma   = weights['gamma']   ?? 0.15;
  let delta   = weights['delta']   ?? 0.05;
  let epsilon = weights['epsilon'] ?? 0.10;

  // Normalise scores to [0, 1]
  const normalised = samples.map((s) => ({
    actual: (s.score - 1) / 4,
    props: JSON.parse(s.properties || '{}') as Record<string, number>,
  }));

  // Batch gradient descent
  for (let iter = 0; iter < 5; iter++) {
    let dAlpha = 0, dBeta = 0, dGamma = 0, dDelta = 0, dEpsilon = 0;

    for (const { actual, props } of normalised) {
      const cos     = props['cos']     ?? 0;
      const graph   = props['graph']   ?? 0;
      const recency = props['recency'] ?? 0;
      const cost    = props['cost']    ?? 0;
      const overlap = props['overlap'] ?? 0;

      const predicted = alpha * cos + beta * graph + gamma * recency - delta * cost - epsilon * overlap;
      const error = actual - predicted;

      dAlpha   += lr * error * cos;
      dBeta    += lr * error * graph;
      dGamma   += lr * error * recency;
      dDelta   -= lr * error * cost;
      dEpsilon -= lr * error * overlap;
    }

    const n = normalised.length;
    alpha   = Math.max(minW, Math.min(maxW, alpha   + dAlpha   / n));
    beta    = Math.max(minW, Math.min(maxW, beta    + dBeta    / n));
    gamma   = Math.max(minW, Math.min(maxW, gamma   + dGamma   / n));
    delta   = Math.max(minW, Math.min(maxW, delta   + dDelta   / n));
    epsilon = Math.max(minW, Math.min(maxW, epsilon + dEpsilon / n));
  }

  const now = Date.now();
  const stmt = db.prepare(`UPDATE weights SET value = ?, updated_at = ? WHERE key = ?`);
  stmt.run(alpha,   now, 'alpha');
  stmt.run(beta,    now, 'beta');
  stmt.run(gamma,   now, 'gamma');
  stmt.run(delta,   now, 'delta');
  stmt.run(epsilon, now, 'epsilon');

  console.log(`[eidos-tuner] Weights updated: α=${alpha.toFixed(3)} β=${beta.toFixed(3)} γ=${gamma.toFixed(3)} δ=${delta.toFixed(3)} ε=${epsilon.toFixed(3)}`);
}
