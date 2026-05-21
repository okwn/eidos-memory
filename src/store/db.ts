import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

let _db: Database.Database | null = null;
let _vssLoaded = false;
let _vecBackend: 'vec' | 'vss' | 'none' = 'none';

const PROJECT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', '.svn'];

/**
 * Walk up from startDir to find the project root (nearest directory containing
 * a known project marker). Falls back to startDir if none found.
 */
export function getProjectRoot(startDir?: string): string {
  // If an explicit startDir is provided, use it directly (no walking up).
  // This ensures test isolation and explicit workspace overrides work correctly.
  if (startDir) return path.resolve(startDir);

  // If EIDOS_WORKSPACE is set (e.g. by tests or MCP server), use it directly.
  const envWs = process.env['EIDOS_WORKSPACE'];
  if (envWs) return path.resolve(envWs);

  // Otherwise walk up from cwd to find the nearest project root.
  let dir = path.resolve(process.cwd());
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (PROJECT_MARKERS.some(m => fs.existsSync(path.join(dir, m)))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.resolve(process.cwd());
}

/**
 * Resolve the .eidos directory for the current project.
 * Creates it if it doesn't exist.
 */
export function getEidosDir(startDir?: string): string {
  const projectRoot = getProjectRoot(startDir);
  const eidosDir = path.join(projectRoot, '.eidos');
  fs.mkdirSync(eidosDir, { recursive: true });
  return eidosDir;
}

export function getWorkspaceHash(workspacePath?: string): string {
  const ws = workspacePath ?? process.env['EIDOS_WORKSPACE'] ?? process.cwd();
  return crypto.createHash('sha1').update(path.resolve(ws)).digest('hex').slice(0, 12);
}

export function getDbPath(workspacePath?: string): string {
  const eidosDir = getEidosDir(workspacePath);
  return path.join(eidosDir, 'memory.db');
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

    -- Structured memory tables (Claude Mem-inspired)
    CREATE TABLE IF NOT EXISTS eidos_sessions (
      id                   TEXT PRIMARY KEY,
      project              TEXT NOT NULL,
      platform             TEXT DEFAULT 'unknown',
      status               TEXT DEFAULT 'active',
      started_at           INTEGER,
      ended_at             INTEGER,
      last_assistant_msg   TEXT,
      turn_count           INTEGER DEFAULT 0,
      total_tokens         INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS eidos_observations (
      id                   TEXT PRIMARY KEY,
      session_id           TEXT,
      project              TEXT NOT NULL,
      type                 TEXT NOT NULL,
      title                TEXT,
      subtitle             TEXT,
      narrative            TEXT,
      facts                TEXT,
      concepts             TEXT,
      files_read           TEXT,
      files_modified       TEXT,
      discovery_tokens     INTEGER DEFAULT 0,
      content_hash         TEXT,
      created_at           INTEGER,
      FOREIGN KEY (session_id) REFERENCES eidos_sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_obs_session ON eidos_observations(session_id);
    CREATE INDEX IF NOT EXISTS idx_obs_project ON eidos_observations(project);
    CREATE INDEX IF NOT EXISTS idx_obs_type ON eidos_observations(type);
    CREATE INDEX IF NOT EXISTS idx_obs_created ON eidos_observations(created_at);

    CREATE TABLE IF NOT EXISTS eidos_summaries (
      id                   TEXT PRIMARY KEY,
      session_id           TEXT UNIQUE,
      project              TEXT NOT NULL,
      user_requests        TEXT,
      investigations       TEXT,
      learnings            TEXT,
      completed_tasks      TEXT,
      next_steps           TEXT,
      total_read_tokens    INTEGER DEFAULT 0,
      total_discovery_tokens INTEGER DEFAULT 0,
      started_at           INTEGER,
      ended_at             INTEGER,
      FOREIGN KEY (session_id) REFERENCES eidos_sessions(id)
    );

    CREATE TABLE IF NOT EXISTS eidos_prompts (
      id                   TEXT PRIMARY KEY,
      session_id           TEXT,
      project              TEXT NOT NULL,
      prompt               TEXT NOT NULL,
      content_hash         TEXT,
      created_at           INTEGER,
      FOREIGN KEY (session_id) REFERENCES eidos_sessions(id)
    );

    -- Full-text search on prompts
    CREATE VIRTUAL TABLE IF NOT EXISTS eidos_prompts_fts USING fts5(
      prompt, content=eidos_prompts, content_rowid=rowid
    );

    -- Async summarization job queue (non-blocking observation generation)
    CREATE TABLE IF NOT EXISTS pending_messages (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL,
      project      TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'summarize',
      payload      TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      attempts     INTEGER DEFAULT 0,
      created_at   INTEGER,
      processed_at INTEGER,
      error        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_messages(status);
    CREATE INDEX IF NOT EXISTS idx_obs_hash ON eidos_observations(content_hash);

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

  // ── Migration: v0.1.0 → v0.2.0 ──────────────────────────────────────
  // Adds content_hash columns, new tables, and indexes for existing databases.
  const dbVersion = db.pragma('user_version', { simple: true }) as number;
  if (dbVersion < 2) {
    console.error('[eidos-db] Running migration v0.1.0 → v0.2.0...');

    // Add content_hash to existing tables (IF NOT EXISTS not supported in ALTER TABLE)
    try { db.exec(`ALTER TABLE eidos_observations ADD COLUMN content_hash TEXT`); } catch { /* column exists */ }
    try { db.exec(`ALTER TABLE eidos_prompts ADD COLUMN content_hash TEXT`); } catch { /* column exists */ }

    // Create new tables (safe — uses IF NOT EXISTS)
    db.exec(`
      CREATE TABLE IF NOT EXISTS eidos_sessions (
        id                   TEXT PRIMARY KEY,
        project              TEXT NOT NULL,
        platform             TEXT DEFAULT 'unknown',
        status               TEXT DEFAULT 'active',
        started_at           INTEGER,
        ended_at             INTEGER,
        last_assistant_msg   TEXT,
        turn_count           INTEGER DEFAULT 0,
        total_tokens         INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS eidos_summaries (
        id                   TEXT PRIMARY KEY,
        session_id           TEXT UNIQUE,
        project              TEXT NOT NULL,
        user_requests        TEXT,
        investigations       TEXT,
        learnings            TEXT,
        completed_tasks      TEXT,
        next_steps           TEXT,
        total_read_tokens    INTEGER DEFAULT 0,
        total_discovery_tokens INTEGER DEFAULT 0,
        started_at           INTEGER,
        ended_at             INTEGER
      );
      CREATE TABLE IF NOT EXISTS eidos_prompts_fts (
        prompt TEXT
      );
      CREATE TABLE IF NOT EXISTS pending_messages (
        id           TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL,
        project      TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'summarize',
        payload      TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        attempts     INTEGER DEFAULT 0,
        created_at   INTEGER,
        processed_at INTEGER,
        error        TEXT
      );
    `);

    // Add new indexes (safe — IF NOT EXISTS)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_obs_session ON eidos_observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_obs_project ON eidos_observations(project);
      CREATE INDEX IF NOT EXISTS idx_obs_type ON eidos_observations(type);
      CREATE INDEX IF NOT EXISTS idx_obs_created ON eidos_observations(created_at);
      CREATE INDEX IF NOT EXISTS idx_obs_hash ON eidos_observations(content_hash);
      CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_messages(status);
    `);

    db.pragma('user_version = 2');
    console.error('[eidos-db] Migration complete. Database upgraded to v0.2.0.');
  }

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

/** Default retrieval weight values — single source of truth. */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  alpha: 0.6,
  beta: 0.2,
  gamma: 0.15,
  delta: 0.05,
  epsilon: 0.10,
};

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
