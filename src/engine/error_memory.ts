import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { upsertNode, listNodes } from '../store/nodes.js';
import { upsertEdge } from '../store/edges.js';
import { insertVec } from '../store/vector.js';
import { embed } from './embedding.js';

export interface ErrorMemory {
  id: string;
  fingerprint: string;
  errorType: string;
  message: string;
  normalizedTrace: string;
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
  resolvedAt: number | null;
  fix: string | null;
}

// Normalize a stack trace: strip line numbers, file paths with line:col,
// memory addresses, and timestamps — leaving only the structural shape
export function normalizeStackTrace(raw: string): string {
  return raw
    .replace(/\bat\s+.+?:\d+:\d+/g, 'at <frame>')       // at file:line:col
    .replace(/\bat\s+<anonymous>/g, 'at <anonymous>')
    .replace(/\b0x[0-9a-fA-F]+\b/g, '<addr>')            // hex addresses
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z]+/g, '<ts>')      // ISO timestamps
    .replace(/\d+ms\b/g, '<ms>')                          // timings
    .replace(/port\s+\d+/gi, 'port <n>')                  // port numbers
    .replace(/pid\s+\d+/gi, 'pid <n>')                    // PIDs
    .replace(/line\s+\d+/gi, 'line <n>')
    .replace(/column\s+\d+/gi, 'column <n>')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

export function fingerprintError(errorType: string, normalizedTrace: string): string {
  const key = `${errorType}::${normalizedTrace.slice(0, 500)}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export async function recordError(
  db: Database.Database,
  errorType: string,
  message: string,
  rawTrace: string,
  sessionId?: string,
): Promise<{ nodeId: string; isNew: boolean; fingerprint: string }> {
  const normalized = normalizeStackTrace(rawTrace);
  const fingerprint = fingerprintError(errorType, normalized);
  const nodeId = `error:${fingerprint}`;

  const existing = listNodes(db, 'error_memory', 1000)
    .find((n) => (n.properties as Record<string, unknown>)['fingerprint'] === fingerprint);

  const now = Date.now();

  if (existing) {
    const p = existing.properties as Record<string, unknown>;
    upsertNode(db, {
      id: nodeId,
      type: 'error_memory',
      properties: {
        ...(existing.properties as Record<string, unknown>),
        occurrences: (Number(p['occurrences'] ?? 1)) + 1,
        lastSeen: now,
        message, // update to latest message
      },
      embedding: existing.embedding ?? undefined,
      importance: Math.min(1.0, (existing.importance ?? 0.6) + 0.05),
    });
    return { nodeId, isNew: false, fingerprint };
  }

  // New error — embed and store
  const textToEmbed = `${errorType}: ${message}\n${normalized.slice(0, 300)}`;
  const embedding = await embed(textToEmbed);

  upsertNode(db, {
    id: nodeId,
    type: 'error_memory',
    properties: {
      fingerprint,
      errorType,
      message,
      normalizedTrace: normalized,
      occurrences: 1,
      firstSeen: now,
      lastSeen: now,
      resolvedAt: null,
      fix: null,
    },
    embedding,
    importance: 0.7,
  });
  insertVec(db, nodeId, embedding);

  // Link to session if provided
  if (sessionId) {
    upsertEdge(db, {
      source_id: `session:${sessionId}`,
      target_id: nodeId,
      rel_type: 'ENCOUNTERED',
      weight: 1.0,
      properties: { ts: now },
    });
  }

  return { nodeId, isNew: true, fingerprint };
}

export function markErrorResolved(
  db: Database.Database,
  fingerprint: string,
  fix: string,
): boolean {
  const existing = listNodes(db, 'error_memory', 1000)
    .find((n) => (n.properties as Record<string, unknown>)['fingerprint'] === fingerprint);
  if (!existing) return false;

  upsertNode(db, {
    id: existing.id,
    type: 'error_memory',
    properties: {
      ...(existing.properties as Record<string, unknown>),
      resolvedAt: Date.now(),
      fix,
    },
    embedding: existing.embedding ?? undefined,
    importance: existing.importance,
  });
  return true;
}
