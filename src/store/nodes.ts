import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface EidosNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  embedding?: Float32Array | null;
  importance: number;
  last_accessed: number;
  created_at: number;
  updated_at: number;
}

export interface NodeRow {
  id: string;
  type: string;
  properties: string;
  embedding: Buffer | null;
  importance: number;
  last_accessed: number;
  created_at: number;
  updated_at: number;
}

function rowToNode(row: NodeRow): EidosNode {
  return {
    id: row.id,
    type: row.type,
    properties: JSON.parse(row.properties || '{}'),
    embedding: row.embedding ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4) : null,
    importance: row.importance,
    last_accessed: row.last_accessed,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function upsertNode(
  db: Database.Database,
  node: Omit<EidosNode, 'id' | 'created_at' | 'updated_at' | 'last_accessed'> & { id?: string },
): string {
  const id = node.id ?? randomUUID();
  const now = Date.now();

  let embBuf: Buffer | null = null;
  if (node.embedding) {
    embBuf = Buffer.from(node.embedding.buffer);
  }

  db.prepare(`
    INSERT INTO nodes (id, type, properties, embedding, importance, last_accessed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type          = excluded.type,
      properties    = excluded.properties,
      embedding     = excluded.embedding,
      importance    = excluded.importance,
      last_accessed = excluded.last_accessed,
      updated_at    = excluded.updated_at
  `).run(id, node.type, JSON.stringify(node.properties), embBuf, node.importance, now, now, now);

  return id;
}

export function getNode(db: Database.Database, id: string): EidosNode | null {
  const row = db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id) as NodeRow | undefined;
  if (!row) return null;
  db.prepare(`UPDATE nodes SET last_accessed = ? WHERE id = ?`).run(Date.now(), id);
  return rowToNode(row);
}

export function listNodes(db: Database.Database, type?: string, limit = 100): EidosNode[] {
  const rows = type
    ? (db.prepare(`SELECT * FROM nodes WHERE type = ? ORDER BY last_accessed DESC LIMIT ?`).all(type, limit) as NodeRow[])
    : (db.prepare(`SELECT * FROM nodes ORDER BY last_accessed DESC LIMIT ?`).all(limit) as NodeRow[]);
  return rows.map(rowToNode);
}

export function deleteNode(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM nodes WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM edges WHERE source_id = ? OR target_id = ?`).run(id, id);
}

export function touchNode(db: Database.Database, id: string): void {
  db.prepare(`UPDATE nodes SET last_accessed = ? WHERE id = ?`).run(Date.now(), id);
}

export function countNodes(db: Database.Database, type?: string): number {
  const row = type
    ? (db.prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE type = ?`).get(type) as { cnt: number })
    : (db.prepare(`SELECT COUNT(*) as cnt FROM nodes`).get() as { cnt: number });
  return row.cnt;
}

export function getAllEmbeddings(db: Database.Database): Array<{ id: string; embedding: Float32Array }> {
  const rows = db.prepare(`SELECT id, embedding FROM nodes WHERE embedding IS NOT NULL`).all() as Array<{ id: string; embedding: Buffer }>;
  return rows
    .filter((r) => r.embedding)
    .map((r) => ({
      id: r.id,
      embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
    }));
}
