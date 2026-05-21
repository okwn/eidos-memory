import { getDb } from '../../store/db.js';
import { listNodes } from '../../store/nodes.js';
import { generateObservations, generateSessionSummary } from '../../engine/generation.js';
import { createObservation, createSummary, createSession, endSession } from '../../store/memory_store.js';
import { SummariserBackend } from '../../engine/summariser/index.js';

/**
 * Summarize a session: extract structured observations and create a summary.
 * Called by hooks (Gemini, Cursor, Windsurf) and by the daemon.
 */
export async function summarizeCommand(opts: {
  project?: string;
  session_id?: string;
  platform?: string;
  backend?: string;
}): Promise<void> {
  const db = getDb();
  const project = opts.project ?? process.env['EIDOS_WORKSPACE'] ?? process.cwd();
  const sessionId = opts.session_id ?? 'default';
  const platform = opts.platform ?? 'unknown';
  const backend = (opts.backend ?? 'local') as SummariserBackend;

  // Get conversation turns for this session
  const turns = listNodes(db, 'conversation_turn', 100)
    .filter((n) => (n.properties as Record<string, unknown>)['session_id'] === sessionId)
    .map((n) => {
      const p = n.properties as Record<string, unknown>;
      return { role: String(p['role']), content: String(p['content'] ?? '') };
    });

  if (turns.length === 0) {
    console.log('[eidos] No conversation turns found for session:', sessionId);
    return;
  }

  // Ensure session exists in structured store
  createSession(project, platform, sessionId);

  // Generate observations
  console.log(`[eidos] Generating observations from ${turns.length} turns...`);
  const observations = await generateObservations(turns, backend);
  for (const obs of observations) {
    createObservation({
      session_id: sessionId,
      project,
      type: obs.type,
      title: obs.title,
      narrative: obs.narrative,
      facts: obs.facts,
      concepts: obs.concepts,
      files_read: obs.files_read,
      files_modified: obs.files_modified,
    });
    console.log(`  [eidos] Observation: ${obs.title} (${obs.type})`);
  }

  // Generate summary
  console.log('[eidos] Generating session summary...');
  const summary = await generateSessionSummary(turns, backend);
  createSummary({
    session_id: sessionId,
    project,
    user_requests: summary.user_requests,
    investigations: summary.investigations,
    learnings: summary.learnings,
    completed_tasks: summary.completed_tasks,
    next_steps: summary.next_steps,
  });

  // End the session
  endSession(sessionId);

  console.log(`[eidos] Session summarized: ${observations.length} observations, 1 summary`);
}
