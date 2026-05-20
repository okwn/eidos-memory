import Database from 'better-sqlite3';
import { isVssLoaded, getVecBackend } from './db.js';
import { getAllEmbeddings } from './nodes.js';

export interface VecSearchResult {
  id: string;
  distance: number;
}

function embeddingToBlob(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

// sqlite-vec uses integer rowids — maintain a rowid↔node_id mapping
function ensureVecRowidTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vec_rowid_map (
      rowid  INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT UNIQUE NOT NULL
    )
  `);
}

function getOrCreateRowid(db: Database.Database, nodeId: string): number {
  ensureVecRowidTable(db);
  const existing = db.prepare(`SELECT rowid FROM vec_rowid_map WHERE node_id = ?`).get(nodeId) as { rowid: number } | undefined;
  if (existing) return existing.rowid;
  const result = db.prepare(`INSERT INTO vec_rowid_map (node_id) VALUES (?)`).run(nodeId);
  return Number(result.lastInsertRowid);
}

export function insertVec(db: Database.Database, nodeId: string, embedding: Float32Array): void {
  if (!isVssLoaded()) return;
  const backend = getVecBackend();
  try {
    if (backend === 'vec') {
      const rowid = getOrCreateRowid(db, nodeId);
      db.prepare(`INSERT OR REPLACE INTO vec_nodes(rowid, embedding) VALUES (?, ?)`)
        .run(rowid, embeddingToBlob(embedding));
    } else {
      db.prepare(`INSERT OR REPLACE INTO vec_nodes(rowid, embedding) VALUES (?, ?)`)
        .run(nodeId, embeddingToBlob(embedding));
    }
  } catch { /* degrade silently */ }
}

export function deleteVec(db: Database.Database, nodeId: string): void {
  if (!isVssLoaded()) return;
  const backend = getVecBackend();
  try {
    if (backend === 'vec') {
      const row = db.prepare(`SELECT rowid FROM vec_rowid_map WHERE node_id = ?`).get(nodeId) as { rowid: number } | undefined;
      if (row) db.prepare(`DELETE FROM vec_nodes WHERE rowid = ?`).run(row.rowid);
    } else {
      db.prepare(`DELETE FROM vec_nodes WHERE rowid = ?`).run(nodeId);
    }
  } catch { /* ignore */ }
}

export function searchVec(
  db: Database.Database,
  queryEmbedding: Float32Array,
  k: number,
): VecSearchResult[] {
  if (isVssLoaded()) {
    try {
      const backend = getVecBackend();
      return backend === 'vec'
        ? searchSqliteVec(db, queryEmbedding, k)
        : searchVss(db, queryEmbedding, k);
    } catch {
      // fall through to linear
    }
  }
  return searchLinear(db, queryEmbedding, k);
}

function searchSqliteVec(
  db: Database.Database,
  queryEmbedding: Float32Array,
  k: number,
): VecSearchResult[] {
  const blob = embeddingToBlob(queryEmbedding);
  // sqlite-vec KNN syntax: WHERE rowid IN (SELECT rowid FROM vec_nodes WHERE knn_match(...))
  const rows = db.prepare(`
    SELECT v.rowid, v.distance, m.node_id
    FROM vec_nodes v
    JOIN vec_rowid_map m ON m.rowid = v.rowid
    WHERE v.embedding MATCH ?
    ORDER BY v.distance
    LIMIT ?
  `).all(blob, k) as Array<{ rowid: number; distance: number; node_id: string }>;
  return rows.map((r) => ({ id: r.node_id, distance: r.distance }));
}

function searchVss(
  db: Database.Database,
  queryEmbedding: Float32Array,
  k: number,
): VecSearchResult[] {
  const blob = embeddingToBlob(queryEmbedding);
  const rows = db.prepare(`
    SELECT rowid, distance
    FROM vec_nodes
    WHERE vss_search(embedding, vss_search_params(?, ?))
  `).all(blob, k) as Array<{ rowid: string; distance: number }>;
  return rows.map((r) => ({ id: r.rowid, distance: r.distance }));
}

function searchLinear(
  db: Database.Database,
  queryEmbedding: Float32Array,
  k: number,
): VecSearchResult[] {
  const all = getAllEmbeddings(db);
  const scored = all.map((item) => ({
    id: item.id,
    distance: 1 - cosineSimilarity(queryEmbedding, item.embedding),
  }));
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, k);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
