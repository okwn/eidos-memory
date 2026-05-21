import { randomUUID } from 'crypto';
import { getDb } from '../../store/db.js';
import { upsertNode, listNodes } from '../../store/nodes.js';
import { upsertEdge } from '../../store/edges.js';
import { insertVec } from '../../store/vector.js';
import { embed } from '../../engine/embedding.js';
import { summarise } from '../../engine/summariser/index.js';
import { recordImplicitFeedback } from './feedback.js';

async function microSummary(role: string, content: string, backend = 'local'): Promise<string> {
  const raw = await summarise(content, backend as 'local', { maxTokens: 30, style: 'micro' });
  return `${role}: ${raw}`;
}

function buildMesoBlock(turns: Array<{ role: string; content: string; micro_summary: string }>): Record<string, unknown> {
  const goal = turns[0]?.micro_summary ?? '';
  const steps = turns.map((t, i) => `${i + 1}. ${t.micro_summary}`);
  const conclusion = turns[turns.length - 1]?.micro_summary ?? '';
  const errors = turns
    .filter((t) => t.content.toLowerCase().includes('error') || t.content.toLowerCase().includes('fail'))
    .map((t) => t.micro_summary);
  return { goal, steps, conclusion, errors, fix_commit: null, duration_min: null };
}

export async function handleLogConversation(params: Record<string, unknown>) {
  const db = getDb();
  const role      = String(params['role'] ?? 'user');
  const content   = String(params['content'] ?? '');
  const sessionId = String(params['session_id'] ?? 'default');
  const platform  = String(params['platform'] ?? 'unknown'); // qwen, claude, gemini, etc.

  // Ensure session node exists with platform tracking
  const sessionNodeId = `session:${sessionId}`;
  const existingSession = db.prepare('SELECT id FROM nodes WHERE id = ?').get(sessionNodeId);
  if (!existingSession) {
    upsertNode(db, {
      id: sessionNodeId,
      type: 'session',
      properties: { session_id: sessionId, platform, started_at: Date.now(), status: 'active' },
      importance: 0.5,
    });
  }

  const micro = await microSummary(role, content);
  const embedding = await embed(micro);
  const turnId = `turn:${sessionId}:${randomUUID()}`;

  upsertNode(db, {
    id: turnId,
    type: 'conversation_turn',
    properties: { role, content, micro_summary: micro, session_id: sessionId, platform },
    embedding,
    importance: 0.4,
  });
  insertVec(db, turnId, embedding);

  // Link turn to session
  upsertEdge(db, {
    source_id: turnId,
    target_id: sessionNodeId,
    rel_type: 'BELONGS_TO_SESSION',
    weight: 1.0,
    properties: {},
  });

  // Count turns in this session to decide meso-block creation
  const sessionTurns = listNodes(db, 'conversation_turn', 500)
    .filter((n) => (n.properties as Record<string, unknown>)['session_id'] === sessionId);

  // Link to previous turn
  if (sessionTurns.length >= 2) {
    const prevTurn = sessionTurns[sessionTurns.length - 2];
    upsertEdge(db, {
      source_id: prevTurn.id,
      target_id: turnId,
      rel_type: 'NEXT',
      weight: 1.0,
      properties: {},
    });
  }

  let mesoBlockCreated = false;
  if (sessionTurns.length % 5 === 0) {
    // Create meso block from last 5 turns
    const lastFive = sessionTurns.slice(-5).map((n) => {
      const p = n.properties as Record<string, unknown>;
      return { role: String(p['role']), content: String(p['content']), micro_summary: String(p['micro_summary'] ?? '') };
    });
    const mesoData = buildMesoBlock(lastFive);
    const mesoText = `Goal: ${mesoData['goal']}\nConclusion: ${mesoData['conclusion']}`;
    const mesoEmbed = await embed(mesoText);
    const mesoId = `meso:${sessionId}:${randomUUID()}`;

    upsertNode(db, {
      id: mesoId,
      type: 'meso_block',
      properties: { ...mesoData, session_id: sessionId },
      embedding: mesoEmbed,
      importance: 0.7,
    });
    insertVec(db, mesoId, mesoEmbed);

    // Link turns to meso block
    for (const t of sessionTurns.slice(-5)) {
      upsertEdge(db, {
        source_id: t.id,
        target_id: mesoId,
        rel_type: 'BELONGS_TO_BLOCK',
        weight: 1.0,
        properties: {},
      });
    }
    mesoBlockCreated = true;
  }

  // Implicit feedback: if same session sent a turn within 30s of a previous one, record re-search signal
  const recentTurns = sessionTurns.slice(-2);
  if (recentTurns.length === 2) {
    const prev = recentTurns[0]!;
    const gap = Date.now() - prev.last_accessed;
    if (gap < 30_000) {
      recordImplicitFeedback(sessionId, 2.5, 'implicit_research');
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ turn_id: turnId, meso_block_created: mesoBlockCreated }),
    }],
  };
}
