import path from 'path';
import os from 'os';
import fs from 'fs';
import Database from 'better-sqlite3';
import { getWorkspaceHash } from '../store/db.js';
import { cosineSimilarity } from '../store/vector.js';

export interface FederatedResult {
  id: string;
  workspaceHash: string;
  workspacePath: string;
  type: string;
  representation: string;
  score: number;
  tokens: number;
}

interface NodeRow {
  id: string;
  type: string;
  properties: string;
  embedding: Buffer | null;
  importance: number;
  last_accessed: number;
}

function getRegisteredWorkspaces(): Array<{ hash: string; rootPath: string }> {
  const registryPath = path.join(os.homedir(), '.eidos', 'workspaces.json');
  if (!fs.existsSync(registryPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as Array<{ hash: string; rootPath: string }>;
  } catch {
    return [];
  }
}

export function registerWorkspace(rootPath: string): void {
  const registryPath = path.join(os.homedir(), '.eidos', 'workspaces.json');
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });

  const existing = getRegisteredWorkspaces();
  const hash = getWorkspaceHash(rootPath);

  if (existing.some((w) => w.hash === hash)) return; // already registered

  existing.push({ hash, rootPath });
  fs.writeFileSync(registryPath, JSON.stringify(existing, null, 2));
}

export function deregisterWorkspace(rootPath: string): void {
  const registryPath = path.join(os.homedir(), '.eidos', 'workspaces.json');
  const existing = getRegisteredWorkspaces();
  const hash = getWorkspaceHash(rootPath);
  const filtered = existing.filter((w) => w.hash !== hash);
  fs.writeFileSync(registryPath, JSON.stringify(filtered, null, 2));
}

function openRemoteDb(wsHash: string): Database.Database | null {
  const dbPath = path.join(os.homedir(), '.eidos', wsHash, 'memory.db');
  if (!fs.existsSync(dbPath)) return null;
  try {
    return new Database(dbPath, { readonly: true });
  } catch {
    return null;
  }
}

function getRepresentation(props: Record<string, unknown>, type: string): string {
  if (type === 'chunk' || type === 'file') {
    return String(props['skeleton'] ?? props['name'] ?? props['path'] ?? type);
  }
  if (type === 'decision') return String(props['statement'] ?? '');
  if (type === 'conversation_turn') return String(props['micro_summary'] ?? '');
  if (type === 'meso_block') return String(props['goal'] ?? '');
  return JSON.stringify(props).slice(0, 120);
}

export async function federatedSearch(
  queryEmbedding: Float32Array,
  k = 10,
  excludeCurrentWs?: string,
): Promise<FederatedResult[]> {
  const workspaces = getRegisteredWorkspaces();
  if (workspaces.length === 0) return [];

  const results: FederatedResult[] = [];

  for (const ws of workspaces) {
    if (ws.hash === excludeCurrentWs) continue;

    const db = openRemoteDb(ws.hash);
    if (!db) continue;

    try {
      const rows = db.prepare(`
        SELECT id, type, properties, embedding, importance, last_accessed
        FROM nodes
        WHERE embedding IS NOT NULL AND (properties NOT LIKE '%"archived":true%')
        ORDER BY last_accessed DESC
        LIMIT 500
      `).all() as NodeRow[];

      for (const row of rows) {
        if (!row.embedding) continue;
        const emb = new Float32Array(
          row.embedding.buffer,
          row.embedding.byteOffset,
          row.embedding.byteLength / 4,
        );
        const sim = cosineSimilarity(queryEmbedding, emb);
        if (sim < 0.3) continue; // skip low-similarity

        const props = JSON.parse(row.properties || '{}') as Record<string, unknown>;
        const repr = getRepresentation(props, row.type);

        results.push({
          id: `${ws.hash}::${row.id}`,
          workspaceHash: ws.hash,
          workspacePath: ws.rootPath,
          type: row.type,
          representation: repr,
          score: sim * row.importance,
          tokens: Math.ceil(repr.length / 4),
        });
      }
    } finally {
      db.close();
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, k);
}
