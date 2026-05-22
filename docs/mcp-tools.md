# MCP Tools Reference

EidosCore exposes **16 tools** via the Model Context Protocol (MCP). These tools are available to any MCP-compatible client.

---

## Context & Retrieval

### `assemble_context`

Build an optimal context block within a token budget.

**Input:**
```json
{
  "query": "explain the auth flow",
  "activeFile": "src/auth.ts",
  "budget": 2000
}
```

**Output:** Context block with relevant code chunks, saved decisions, and recent changes.

### `search_memory`

Semantic, timeline, or recent search across memories.

**Input:**
```json
{
  "query": "database connection pooling",
  "mode": "semantic",
  "limit": 10
}
```

**Modes:** `semantic` (vector search), `timeline` (chronological), `recent` (last N)

### `get_context_delta`

Return only new context since the last `assemble_context` call — avoids redundant data.

### `prefetch`

Pre-warm the retrieval cache from IDE signals (open files, cursor position).

---

## Memory Storage

### `remember`

Store a decision, fact, or observation.

```json
{
  "title": "Use bcrypt for password hashing",
  "content": "Decision: use bcrypt with 12 salt rounds",
  "tags": ["security", "auth"]
}
```

Content is SHA-256 dedup'd — identical entries are silently skipped.

### `log_conversation`

Store a conversation turn (auto-generates micro-summary).

### `get_observation`

Get full details of a specific memory with linked nodes.

```json
{
  "observationId": "obs_abc123"
}
```

### `list_recent`

List recent memories chronologically.

```json
{
  "limit": 20,
  "since": "2026-05-01T00:00:00Z"
}
```

---

## Session Management

### `generate_qms`

Save a session snapshot (Quantum Memory Seed). Restores cognitive state when resuming.

### `load_qms`

Restore session state from a QMS snapshot. Pre-warms top-50 nodes in cache.

---

## Indexing

### `index_project`

Index a directory into the knowledge graph.

```json
{
  "path": "/path/to/project",
  "languages": ["ts", "js", "py"]
}
```

### `update_file`

Re-index a single file — computes diff vs stored version.

```json
{
  "filePath": "src/auth.ts"
}
```

---

## Utilities

### `compress_text`

Compress text via skeleton extraction, diff, or summarization.

### `feedback`

Rate context assembly quality (1-5) — feeds the SGD tuner for automatic weight optimization.

```json
{
  "rating": 4,
  "sessionId": "session_abc"
}
```

---

## Tool Overview

| Tool | Category | Purpose |
|------|----------|---------|
| `assemble_context` | Context | Build optimal context within budget |
| `search_memory` | Context | Semantic/timeline/recent search |
| `get_context_delta` | Context | Only new context since last call |
| `prefetch` | Context | Pre-warm cache from IDE signals |
| `remember` | Storage | Store dedup'd decision/fact |
| `log_conversation` | Storage | Store conversation turn |
| `get_observation` | Storage | Get full memory details |
| `list_recent` | Storage | List memories chronologically |
| `generate_qms` | Session | Save session snapshot |
| `load_qms` | Session | Restore session state |
| `index_project` | Indexing | Index directory into graph |
| `update_file` | Indexing | Re-index single file |
| `compress_text` | Utility | Skeleton/diff/summary compression |
| `feedback` | Utility | Rate quality (1-5) for tuning |
