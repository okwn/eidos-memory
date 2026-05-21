import { getDb } from '../store/db.js';
import { listNodes, upsertNode } from '../store/nodes.js';
import { upsertEdge } from '../store/edges.js';
import { randomUUID } from 'crypto';

export async function replaySession(sessionId: string): Promise<void> {
  const db = getDb();

  // Collect all turns for session in chronological order
  const turns = listNodes(db, 'conversation_turn', 1000)
    .filter((n) => (n.properties as Record<string, unknown>)['session_id'] === sessionId)
    .sort((a, b) => a.created_at - b.created_at);

  if (turns.length === 0) {
    console.log(`[eidos] No conversation turns found for session: ${sessionId}`);
    return;
  }

  // Collect meso-blocks for this session
  const mesoBlocks = listNodes(db, 'meso_block', 200)
    .filter((n) => (n.properties as Record<string, unknown>)['session_id'] === sessionId)
    .sort((a, b) => a.created_at - b.created_at);

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  EidosCore Session Replay: ${sessionId.slice(0, 24).padEnd(24)} ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);

  // Print meso-block summaries first
  if (mesoBlocks.length > 0) {
    console.log(`📦 Meso-blocks (${mesoBlocks.length}):`);
    for (const mb of mesoBlocks) {
      const p = mb.properties as Record<string, unknown>;
      const ts = new Date(mb.created_at).toISOString();
      console.log(`  [${ts}] Goal: ${p['goal']}`);
      console.log(`          Conclusion: ${p['conclusion']}`);
      if (Array.isArray(p['errors']) && (p['errors'] as unknown[]).length > 0) {
        console.log(`          Errors: ${(p['errors'] as string[]).join('; ')}`);
      }
    }
    console.log('');
  }

  // Replay turns
  console.log(`💬 Conversation turns (${turns.length}):`);
  for (const turn of turns) {
    const p  = turn.properties as Record<string, unknown>;
    const ts = new Date(turn.created_at).toISOString().slice(11, 19);
    const role = String(p['role']).padEnd(9);
    const summary = String(p['micro_summary'] ?? p['content'] ?? '').slice(0, 100);
    console.log(`  [${ts}] ${role} ${summary}`);
  }
  console.log('');
}

export async function branchSession(
  mesoBlockId: string,
  newSessionId?: string,
): Promise<string> {
  const db = getDb();
  const branchId = newSessionId ?? `branch-${randomUUID().slice(0, 8)}`;

  // Get the meso block
  const allMeso = listNodes(db, 'meso_block', 200);
  const meso = allMeso.find((n) => n.id === mesoBlockId);
  if (!meso) {
    throw new Error(`Meso block not found: ${mesoBlockId}`);
  }

  const p = meso.properties as Record<string, unknown>;
  const parentSessionId = String(p['session_id'] ?? '');

  // Get all turns that belong to this meso-block
  // (edges from turns to meso — stored as source=turn, target=meso)
  const turnEdges = db.prepare(`
    SELECT source_id FROM edges WHERE target_id = ? AND rel_type = 'BELONGS_TO_BLOCK'
  `).all(mesoBlockId) as Array<{ source_id: string }>;

  // Clone the meso-block into the new branch session
  upsertNode(db, {
    id: `meso:${branchId}:${randomUUID()}`,
    type: 'meso_block',
    properties: {
      ...p,
      session_id: branchId,
      branched_from: mesoBlockId,
      parent_session: parentSessionId,
    },
    embedding: meso.embedding ?? undefined,
    importance: meso.importance,
  });

  // Create branch edge: original meso → branch meso
  upsertEdge(db, {
    source_id: mesoBlockId,
    target_id: `meso:${branchId}:branch`,
    rel_type: 'BRANCHED_INTO',
    weight: 1.0,
    properties: { branch_session: branchId, ts: Date.now() },
  });

  console.log(`[eidos] Branched from meso-block '${mesoBlockId}' → new session '${branchId}'`);
  console.log(`[eidos] Branch inherits ${turnEdges.length} turns from parent session '${parentSessionId}'`);
  console.log(`[eidos] Use session_id='${branchId}' to continue in the branch.`);

  return branchId;
}
