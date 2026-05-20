import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface EidosEdge {
  id: string;
  source_id: string;
  target_id: string;
  rel_type: string;
  weight: number;
  properties: Record<string, unknown>;
}

interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  rel_type: string;
  weight: number;
  properties: string;
}

function rowToEdge(row: EdgeRow): EidosEdge {
  return {
    id: row.id,
    source_id: row.source_id,
    target_id: row.target_id,
    rel_type: row.rel_type,
    weight: row.weight,
    properties: JSON.parse(row.properties || '{}'),
  };
}

export function upsertEdge(
  db: Database.Database,
  edge: Omit<EidosEdge, 'id'> & { id?: string },
): string {
  const id = edge.id ?? randomUUID();
  db.prepare(`
    INSERT INTO edges (id, source_id, target_id, rel_type, weight, properties)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      weight     = excluded.weight,
      properties = excluded.properties
  `).run(id, edge.source_id, edge.target_id, edge.rel_type, edge.weight, JSON.stringify(edge.properties));
  return id;
}

export function getEdgesFrom(db: Database.Database, sourceId: string, relType?: string): EidosEdge[] {
  const rows = relType
    ? (db.prepare(`SELECT * FROM edges WHERE source_id = ? AND rel_type = ?`).all(sourceId, relType) as EdgeRow[])
    : (db.prepare(`SELECT * FROM edges WHERE source_id = ?`).all(sourceId) as EdgeRow[]);
  return rows.map(rowToEdge);
}

export function getEdgesTo(db: Database.Database, targetId: string, relType?: string): EidosEdge[] {
  const rows = relType
    ? (db.prepare(`SELECT * FROM edges WHERE target_id = ? AND rel_type = ?`).all(targetId, relType) as EdgeRow[])
    : (db.prepare(`SELECT * FROM edges WHERE target_id = ?`).all(targetId) as EdgeRow[]);
  return rows.map(rowToEdge);
}

export function getEdges(db: Database.Database, nodeId: string): EidosEdge[] {
  const rows = db.prepare(
    `SELECT * FROM edges WHERE source_id = ? OR target_id = ?`
  ).all(nodeId, nodeId) as EdgeRow[];
  return rows.map(rowToEdge);
}

export function deleteEdge(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM edges WHERE id = ?`).run(id);
}

export function deleteEdgesBetween(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  relType?: string,
): void {
  if (relType) {
    db.prepare(`DELETE FROM edges WHERE source_id = ? AND target_id = ? AND rel_type = ?`).run(sourceId, targetId, relType);
  } else {
    db.prepare(`DELETE FROM edges WHERE source_id = ? AND target_id = ?`).run(sourceId, targetId);
  }
}

export function getNeighbourIds(db: Database.Database, nodeId: string, maxHops = 2): Map<string, number> {
  const visited = new Map<string, number>();
  let frontier = [nodeId];
  for (let hop = 1; hop <= maxHops; hop++) {
    if (frontier.length === 0) break;
    const placeholders = frontier.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT source_id, target_id FROM edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`
    ).all(...frontier, ...frontier) as Array<{ source_id: string; target_id: string }>;
    const next: string[] = [];
    for (const row of rows) {
      for (const nid of [row.source_id, row.target_id]) {
        if (nid !== nodeId && !visited.has(nid)) {
          visited.set(nid, hop);
          next.push(nid);
        }
      }
    }
    frontier = next;
  }
  return visited;
}
