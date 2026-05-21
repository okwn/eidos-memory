import crypto from 'crypto';
import { getDb } from './db.js';

// ── Session Management ─────────────────────────────────────────────────────

export interface EidosSession {
  id: string;
  project: string;
  platform: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  last_assistant_msg: string | null;
  turn_count: number;
  total_tokens: number;
}

export function createSession(project: string, platform: string, sessionId?: string): string {
  const db = getDb();
  const id = sessionId ?? `session:${crypto.randomUUID()}`;
  db.prepare(`
    INSERT OR IGNORE INTO eidos_sessions (id, project, platform, status, started_at)
    VALUES (?, ?, ?, 'active', ?)
  `).run(id, project, platform, Date.now());
  return id;
}

export function endSession(sessionId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE eidos_sessions SET status = 'completed', ended_at = ? WHERE id = ?
  `).run(Date.now(), sessionId);
}

export function getSession(sessionId: string): EidosSession | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM eidos_sessions WHERE id = ?').get(sessionId) as EidosSession | undefined;
}

export function getActiveSessions(project?: string): EidosSession[] {
  const db = getDb();
  if (project) {
    return db.prepare("SELECT * FROM eidos_sessions WHERE status = 'active' AND project = ?").all(project) as EidosSession[];
  }
  return db.prepare("SELECT * FROM eidos_sessions WHERE status = 'active'").all() as EidosSession[];
}

export function incrementTurnCount(sessionId: string): void {
  const db = getDb();
  db.prepare('UPDATE eidos_sessions SET turn_count = turn_count + 1 WHERE id = ?').run(sessionId);
}

// ── Observation Management ─────────────────────────────────────────────────

export interface EidosObservation {
  id: string;
  session_id: string;
  project: string;
  type: string;
  title: string;
  subtitle: string | null;
  narrative: string | null;
  facts: string | null;       // JSON array
  concepts: string | null;    // JSON array
  files_read: string | null;  // JSON array
  files_modified: string | null; // JSON array
  discovery_tokens: number;
  content_hash: string | null;
  created_at: number;
}

export function createObservation(opts: {
  session_id: string;
  project: string;
  type: string;
  title: string;
  subtitle?: string;
  narrative?: string;
  facts?: string[];
  concepts?: string[];
  files_read?: string[];
  files_modified?: string[];
  discovery_tokens?: number;
}): string {
  const db = getDb();
  const id = `obs:${crypto.randomUUID()}`;
  const contentHash = hashContent(opts.title + (opts.narrative ?? ''));

  // Dedup: skip if identical content exists
  const existing = db.prepare('SELECT id FROM eidos_observations WHERE content_hash = ? AND project = ?')
    .get(contentHash, opts.project) as { id: string } | undefined;
  if (existing) return existing.id;

  db.prepare(`
    INSERT INTO eidos_observations (id, session_id, project, type, title, subtitle, narrative, facts, concepts, files_read, files_modified, discovery_tokens, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.session_id,
    opts.project,
    opts.type,
    opts.title,
    opts.subtitle ?? null,
    opts.narrative ?? null,
    opts.facts ? JSON.stringify(opts.facts) : null,
    opts.concepts ? JSON.stringify(opts.concepts) : null,
    opts.files_read ? JSON.stringify(opts.files_read) : null,
    opts.files_modified ? JSON.stringify(opts.files_modified) : null,
    opts.discovery_tokens ?? 0,
    contentHash,
    Date.now(),
  );
  return id;
}

export function getObservation(id: string): EidosObservation | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM eidos_observations WHERE id = ?').get(id) as EidosObservation | undefined;
}

export function getObservationsByProject(project: string, limit = 50): EidosObservation[] {
  const db = getDb();
  return db.prepare('SELECT * FROM eidos_observations WHERE project = ? ORDER BY created_at DESC LIMIT ?')
    .all(project, limit) as EidosObservation[];
}

export function getObservationsBySession(sessionId: string): EidosObservation[] {
  const db = getDb();
  return db.prepare('SELECT * FROM eidos_observations WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as EidosObservation[];
}

/** Escape SQL LIKE wildcards to prevent pattern injection. */
function escapeLikePattern(str: string): string {
  return str.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function getObservationsByFile(filePath: string, project: string): EidosObservation[] {
  const db = getDb();
  const safePath = escapeLikePattern(filePath);
  return db.prepare(`
    SELECT * FROM eidos_observations
    WHERE project = ? AND (files_read LIKE ? ESCAPE '\\' OR files_modified LIKE ? ESCAPE '\\')
    ORDER BY created_at DESC LIMIT 20
  `).all(project, `%${safePath}%`, `%${safePath}%`) as EidosObservation[];
}

// ── Summary Management ─────────────────────────────────────────────────────

export interface EidosSummary {
  id: string;
  session_id: string;
  project: string;
  user_requests: string | null;
  investigations: string | null;
  learnings: string | null;
  completed_tasks: string | null;
  next_steps: string | null;
  total_read_tokens: number;
  total_discovery_tokens: number;
  started_at: number;
  ended_at: number;
}

export function createSummary(opts: {
  session_id: string;
  project: string;
  user_requests?: string;
  investigations?: string;
  learnings?: string;
  completed_tasks?: string;
  next_steps?: string;
  total_read_tokens?: number;
  total_discovery_tokens?: number;
}): string {
  const db = getDb();
  const session = getSession(opts.session_id);
  const id = `summary:${opts.session_id}`;

  db.prepare(`
    INSERT OR REPLACE INTO eidos_summaries (id, session_id, project, user_requests, investigations, learnings, completed_tasks, next_steps, total_read_tokens, total_discovery_tokens, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.session_id,
    opts.project,
    opts.user_requests ?? null,
    opts.investigations ?? null,
    opts.learnings ?? null,
    opts.completed_tasks ?? null,
    opts.next_steps ?? null,
    opts.total_read_tokens ?? 0,
    opts.total_discovery_tokens ?? 0,
    session?.started_at ?? Date.now(),
    Date.now(),
  );
  return id;
}

export function getSummariesByProject(project: string, limit = 10): EidosSummary[] {
  const db = getDb();
  return db.prepare('SELECT * FROM eidos_summaries WHERE project = ? ORDER BY ended_at DESC LIMIT ?')
    .all(project, limit) as EidosSummary[];
}

// ── Prompt Management ──────────────────────────────────────────────────────

export function recordPrompt(sessionId: string, project: string, prompt: string): string {
  const db = getDb();
  const contentHash = hashContent(prompt);

  // Dedup: skip if identical prompt exists
  const existing = db.prepare('SELECT id FROM eidos_prompts WHERE content_hash = ? AND project = ?')
    .get(contentHash, project) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = `prompt:${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO eidos_prompts (id, session_id, project, prompt, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, project, prompt, contentHash, Date.now());

  // Also insert into FTS index
  try {
    db.prepare('INSERT INTO eidos_prompts_fts (rowid, prompt) VALUES (last_insert_rowid(), ?)').run(prompt);
  } catch (err) {
    console.warn('[eidos] FTS index insert failed (non-critical):', err instanceof Error ? err.message : String(err));
  }

  return id;
}

export function searchPrompts(project: string, query: string, limit = 10): Array<{ prompt: string; created_at: number }> {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT p.prompt, p.created_at FROM eidos_prompts p
      JOIN eidos_prompts_fts fts ON p.rowid = fts.rowid
      WHERE fts MATCH ? AND p.project = ?
      ORDER BY p.created_at DESC LIMIT ?
    `).all(query, project, limit) as Array<{ prompt: string; created_at: number }>;
  } catch {
    // Fallback to LIKE search if FTS fails
    return db.prepare(`
      SELECT prompt, created_at FROM eidos_prompts
      WHERE prompt LIKE ? AND project = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(`%${query}%`, project, limit) as Array<{ prompt: string; created_at: number }>;
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ── Pending Messages Queue (Async Summarization) ──────────────────────────

export interface PendingMessage {
  id: string;
  session_id: string;
  project: string;
  message_type: string;
  payload: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  created_at: number;
  processed_at: number | null;
  error: string | null;
}

export function enqueueMessage(opts: {
  session_id: string;
  project: string;
  message_type?: string;
  payload: Record<string, unknown>;
}): string {
  const db = getDb();
  const id = `msg:${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO pending_messages (id, session_id, project, message_type, payload, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, opts.session_id, opts.project, opts.message_type ?? 'summarize', JSON.stringify(opts.payload), Date.now());
  return id;
}

export function dequeuePending(limit = 5): PendingMessage[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM pending_messages WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?
  `).all(limit) as PendingMessage[];
}

export function markMessageProcessing(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE pending_messages SET status = 'processing', attempts = attempts + 1 WHERE id = ?`).run(id);
}

export function markMessageCompleted(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE pending_messages SET status = 'completed', processed_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function markMessageFailed(id: string, error: string): void {
  const db = getDb();
  db.prepare(`UPDATE pending_messages SET status = 'failed', error = ?, processed_at = ? WHERE id = ?`)
    .run(error, Date.now(), id);
}
