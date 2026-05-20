import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

let _db: Database.Database | null = null;
let _vssLoaded = false;
let _vecBackend: 'vec' | 'vss' | 'none' = 'none';

export function getWorkspaceHash(workspacePath?: string): string {
  const ws = workspacePath ?? process.env['EIDOS_WORKSPACE'] ?? process.cwd();
  return crypto.createHash('sha1').update(path.resolve(ws)).digest('hex').slice(0, 12);
}

export function getDbPath(workspacePath?: string): string {
  const hash = getWorkspaceHash(workspacePath);
  const dir = path.join(os.homedir(), '.eidos', hash);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'memory.db');
}

function tryLoadVec(db: Database.Database): boolean {
  // 1. Try sqlite-vec (modern replacement, vec0 module)
  try {
    const vecModule = _require('sqlite-vec') as { load: (db: Database.Database) => void };
    vecModule.load(db);
    _vecBackend = 'vec';
    _vssLoaded = true;
    return true;
  } catch { /* fall through */ }
  // 2. Fall back to sqlite-vss (legacy)
  try {
    const vssModule = _require('sqlite-vss') as { load: (db: Database.Database) => void };
    vssModule.load(db);
    _vecBackend = 'vss';
    _vssLoaded = true;
    return true;
  } catch { /* fall through */ }
  _vecBackend = 'none';
  return false;
}

export function getDb(workspacePath?: string): Database.Database {
  if (_db) return _db;

  const dbPath = getDbPath(workspacePath);
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  const vssOk = tryLoadVec(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      properties    TEXT,
      embedding     BLOB,
      importance    REAL DEFAULT 0.5,
      last_accessed INTEGER,
      created_at    INTEGER,
      updated_at    INTEGER
    );

    CREATE TABLE IF NOT EXISTS edges (
      id        TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      rel_type  TEXT NOT NULL,
      weight    REAL DEFAULT 1.0,
      properties TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      created_at   INTEGER,
      last_active  INTEGER,
      tokens_saved INTEGER DEFAULT 0,
      dollars_saved REAL DEFAULT 0.0,
      properties   TEXT
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id         TEXT PRIMARY KEY,
      session_id TEXT,
      score      REAL,
      source     TEXT,
      created_at INTEGER,
      properties TEXT
    );

    CREATE TABLE IF NOT EXISTS lifetime_savings (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      tokens_saved INTEGER DEFAULT 0,
      dollars_saved REAL DEFAULT 0.0,
      prompts_count INTEGER DEFAULT 0,
      updated_at   INTEGER
    );
    INSERT OR IGNORE INTO lifetime_savings (id, tokens_saved, dollars_saved, prompts_count, updated_at)
    VALUES (1, 0, 0.0, 0, 0);

    CREATE TABLE IF NOT EXISTS weights (
      key        TEXT PRIMARY KEY,
      value      REAL NOT NULL,
      updated_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_type     ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_accessed ON nodes(last_accessed);
    CREATE INDEX IF NOT EXISTS idx_edges_source   ON edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target   ON edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_edges_type     ON edges(rel_type);
  `);

  if (vssOk) {
    try {
      if (_vecBackend === 'vec') {
        // sqlite-vec: use vec0 virtual table with float[384]
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(embedding float[384])`);
      } else {
        // sqlite-vss legacy
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vss0(embedding(384))`);
      }
    } catch {
      _vssLoaded = false;
      _vecBackend = 'none';
    }
  }

  initDefaultWeights(db);
  _db = db;
  return db;
}

export function isVssLoaded(): boolean {
  return _vssLoaded;
}

export function getVecBackend(): 'vec' | 'vss' | 'none' {
  return _vecBackend;
}

function initDefaultWeights(db: Database.Database): void {
  const defaults: Array<[string, number]> = [
    ['alpha', 0.6],
    ['beta', 0.2],
    ['gamma', 0.15],
    ['delta', 0.05],
    ['epsilon', 0.10],
  ];
  const stmt = db.prepare(`INSERT OR IGNORE INTO weights (key, value, updated_at) VALUES (?, ?, ?)`);
  const now = Date.now();
  for (const [key, value] of defaults) {
    stmt.run(key, value, now);
  }
}

export interface LifetimeSavings {
  tokens_saved: number;
  dollars_saved: number;
  prompts_count: number;
}

export function getLifetimeSavings(db: Database.Database): LifetimeSavings {
  const row = db.prepare(`SELECT tokens_saved, dollars_saved, prompts_count FROM lifetime_savings WHERE id = 1`)
    .get() as LifetimeSavings | undefined;
  return row ?? { tokens_saved: 0, dollars_saved: 0, prompts_count: 0 };
}

export function recordSavings(db: Database.Database, tokensSaved: number, dollarsSaved: number): void {
  // UPSERT ensures the seed row always exists — UPDATE alone is a silent no-op if missing
  db.prepare(`
    INSERT INTO lifetime_savings (id, tokens_saved, dollars_saved, prompts_count, updated_at)
    VALUES (1, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      tokens_saved  = tokens_saved  + excluded.tokens_saved,
      dollars_saved = dollars_saved + excluded.dollars_saved,
      prompts_count = prompts_count + 1,
      updated_at    = excluded.updated_at
  `).run(tokensSaved, dollarsSaved, Date.now());
}

export function getWeights(db: Database.Database): Record<string, number> {
  const rows = db.prepare(`SELECT key, value FROM weights`).all() as Array<{ key: string; value: number }>;
  const result: Record<string, number> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function resetDbInstance(): void {
  _db = null;
  _vssLoaded = false;
  _vecBackend = 'none';
}
