# Database Schema

EidosCore uses SQLite with WAL mode. The database is stored at `.eidos/memory.db` in your project.

---

## Tables

### `nodes`

Knowledge graph nodes — chunks, files, decisions, conversation turns, QMS snapshots.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Unique node identifier |
| `type` | TEXT | Node type: `chunk`, `file`, `decision`, `observation`, `qms`, `turn` |
| `properties` | TEXT (JSON) | Arbitrary properties |
| `importance` | REAL | Importance score (0.0–1.0), decays over time |
| `project` | TEXT | Project identifier |
| `created_at` | INTEGER | Creation timestamp (ms) |
| `updated_at` | INTEGER | Last update timestamp (ms) |
| `accessed_at` | INTEGER | Last access timestamp (ms) |

### `edges`

Graph edges connecting nodes.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Unique edge identifier |
| `source_id` | TEXT | Source node ID |
| `target_id` | TEXT | Target node ID |
| `rel_type` | TEXT | Relationship type: `DEPENDS_ON`, `CONTAINS`, `RELATES_TO` |
| `weight` | REAL | Edge weight |
| `created_at` | INTEGER | Creation timestamp (ms) |

### `vec_nodes`

Vector embeddings for semantic search (sqlite-vec ANN, 384-dim float).

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Matches node ID |
| `embedding` | BLOB | 384-dim float32 vector |

### `sessions`

Session tracking with token savings.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Session ID |
| `project` | TEXT | Project identifier |
| `token_savings` | INTEGER | Tokens saved this session |
| `start_time` | INTEGER | Session start timestamp |
| `end_time` | INTEGER | Session end timestamp |

### `eidos_sessions`

Structured session tracking.

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | TEXT PRIMARY KEY | Session ID |
| `project` | TEXT | Project identifier |
| `platform` | TEXT | Platform (gemini, cursor, claude, etc.) |
| `status` | TEXT | Status: `active`, `completed`, `summarized` |
| `turn_count` | INTEGER | Number of conversation turns |
| `total_tokens` | INTEGER | Total tokens consumed |
| `created_at` | INTEGER | Creation timestamp |

### `eidos_observations`

Structured observations with content deduplication.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Observation ID |
| `session_id` | TEXT | Associated session |
| `project` | TEXT | Project identifier |
| `type` | TEXT | Type: `decision`, `bug`, `code_change`, `concept` |
| `title` | TEXT | Short title |
| `content` | TEXT | Full content (narrative, facts) |
| `tags` | TEXT (JSON) | Array of tags |
| `files` | TEXT (JSON) | Array of related file paths |
| `content_hash` | TEXT | SHA-256 hash for deduplication |
| `importance` | REAL | Importance score |
| `created_at` | INTEGER | Creation timestamp |

### `eidos_summaries`

Session summaries.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Summary ID |
| `session_id` | TEXT | Associated session |
| `project` | TEXT | Project identifier |
| `user_requests` | TEXT | User request summary |
| `learnings` | TEXT | Key learnings |
| `completed_tasks` | TEXT (JSON) | Completed tasks |
| `total_tokens` | INTEGER | Total tokens |
| `created_at` | INTEGER | Creation timestamp |

### `eidos_prompts`

User prompts with FTS5 full-text search and dedup.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Prompt ID |
| `session_id` | TEXT | Associated session |
| `project` | TEXT | Project identifier |
| `content` | TEXT | Prompt content |
| `content_hash` | TEXT | SHA-256 hash for deduplication |
| `created_at` | INTEGER | Creation timestamp |

### `pending_messages`

Async summarization job queue.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment ID |
| `session_id` | TEXT | Session to process |
| `status` | TEXT | `pending`, `processing`, `done`, `failed` |
| `created_at` | INTEGER | Creation timestamp |
| `processed_at` | INTEGER | Processing timestamp |

### `feedback`

Context quality ratings for SGD tuning.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment ID |
| `session_id` | TEXT | Associated session |
| `rating` | INTEGER | Rating 1–5 |
| `created_at` | INTEGER | Creation timestamp |

### `weights`

Retrieval weight values (tuned by SGD).

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment ID |
| `alpha` | REAL | Vector similarity weight |
| `beta` | REAL | Graph boost weight |
| `gamma` | REAL | AST-aware weight |
| `delta` | REAL | Recency boost weight |
| `epsilon` | REAL | Staleness penalty weight |
| `updated_at` | INTEGER | Last update timestamp |

### `lifetime_savings`

Persistent token/dollar savings counter.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Always 1 (singleton) |
| `tokens_saved` | INTEGER | Lifetime tokens saved |
| `money_saved_cents` | INTEGER | Lifetime dollars saved (cents) |
| `sessions_completed` | INTEGER | Total sessions completed |

---

## Indexes

| Table | Index | Type |
|-------|-------|------|
| `nodes` | `idx_nodes_type` | BTREE |
| `nodes` | `idx_nodes_project` | BTREE |
| `nodes` | `idx_nodes_importance` | BTREE |
| `edges` | `idx_edges_source` | BTREE |
| `edges` | `idx_edges_target` | BTREE |
| `edges` | `idx_edges_rel_type` | BTREE |
| `eidos_observations` | `idx_obs_content_hash` | UNIQUE |
| `eidos_observations` | `idx_obs_session` | BTREE |
| `eidos_prompts` | `idx_prompts_content_hash` | UNIQUE |
| `eidos_prompts` | `idx_prompts_fts` | FTS5 |

---

## WAL Mode

The database runs in **WAL (Write-Ahead Logging)** mode for concurrent read/write performance:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA cache_size=-64000;  -- 64 MB cache
```
