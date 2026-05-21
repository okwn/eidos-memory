import { listNodes } from '../store/nodes.js';
import type Database from 'better-sqlite3';

/**
 * Build essentials from recent conversation turns for context assembly.
 * Shared by wrap, proxy, assemble_context, and dashboard.
 */
export function buildEssentialsFromTurns(
  db: Database.Database,
  sessionId?: string,
  maxTurns = 3,
): Array<{ label: string; content: string }> {
  const essentials: Array<{ label: string; content: string }> = [];
  const turns = listNodes(db, 'conversation_turn', 20)
    .filter((n) => {
      if (!sessionId) return true;
      return (n.properties as Record<string, unknown>)['session_id'] === sessionId;
    })
    .slice(-maxTurns);
  for (const t of turns) {
    const p = t.properties as Record<string, unknown>;
    essentials.push({ label: String(p['role']), content: String(p['micro_summary'] ?? p['content'] ?? '') });
  }
  return essentials;
}
