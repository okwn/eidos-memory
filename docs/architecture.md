# Architecture

EidosCore is a local-first knowledge graph engine designed to give AI coding assistants persistent memory across sessions.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     AI CLI / IDE                         │
│  (Claude, Gemini, Qwen, Cursor, Windsurf, VS Code...)   │
└────────────────────────┬────────────────────────────────┘
                         │ MCP / Hook / Plugin / HTTP
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   EidosCore Daemon                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ MCP Server│  │ HTTP API │  │ HTTP Proxy│             │
│  │ :3742    │  │ :7842    │  │ :4141    │              │
│  └────┬─────┘  └────┬─────┘  └──────────┘              │
│       │              │                                   │
│  ┌────▼──────────────▼──────────────────────────────┐   │
│  │              Core Engine                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │   │
│  │  │Retrieval │  │Generation│  │Embedding │       │   │
│  │  │(hybrid)  │  │(summarize│  │(384-dim) │       │   │
│  │  └────┬─────┘  │  + obs) │  └────┬─────┘       │   │
│  │       │         └──────────┘       │             │   │
│  │  ┌────▼────────────────────────────▼──────────┐  │   │
│  │  │              SQLite Database                │  │   │
│  │  │  nodes │ edges │ vec_nodes │ sessions │ ... │  │   │
│  │  └─────────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. CLI Layer (`src/cli/`)

Entry point for all user interactions. Uses Commander.js for command parsing.

| Module | Purpose |
|--------|---------|
| `index.ts` | CLI entry point, command registration |
| `connect.ts` | Auto-detect CLIs, write configs, start daemon |
| `wrap.ts` | Inject memory into any CLI tool |
| `hook.ts` | Stdio JSON hook handler for IDE integrations |
| `daemon.ts` | Background daemon manager |
| `doctor.ts` | 11-point health check |
| `proxy.ts` | OpenAI-compatible HTTP proxy |
| `init.ts` | Project initialization |

### 2. Engine Layer (`src/engine/`)

The brain of EidosCore — manages retrieval, generation, embeddings, and more.

| Module | Purpose |
|--------|---------|
| `retrieval.ts` | Hybrid retrieval (vector + graph + AST + recency) |
| `embedding.ts` | 384-dim embeddings via @xenova/transformers |
| `generation.ts` | AI summarization and observation generation |
| `essentials.ts` | Context assembly within token budget |
| `intent.ts` | Query intent classification |
| `privacy.ts` | Secret redaction, `<private>` tags, `.eidosignore` |
| `tokens.ts` | Token counting via js-tiktoken (cl100k_base) |
| `budget.ts` | Adaptive token budget management |
| `decay.ts` | Importance decay for memory optimization |
| `audit.ts` | Context assembly audit trail |
| `telemetry.ts` | Anonymous usage telemetry (opt-in) |
| `federation.ts` | Cross-instance memory federation |
| `error_memory.ts` | Error pattern learning |

### 3. Ingestion Pipeline (`src/engine/ingestion/`)

Handles codebase indexing and AST parsing.

| Module | Purpose |
|--------|---------|
| `chunker.ts` | Tree-sitter AST code chunking (10 languages) |
| `differ.ts` | File diff computation for incremental indexing |
| `skeleton.ts` | Code skeleton extraction for AST-aware scoring |

### 4. Summarizer (`src/engine/summariser/`)

Generates structured observations and session summaries.

### 5. MCP Layer (`src/mcp/`)

Model Context Protocol server with 16 tools.

| Module | Purpose |
|--------|---------|
| `server.ts` | MCP server (stdio transport) |
| `tool_definitions.ts` | Tool schema definitions |
| `tools/*.ts` | Individual tool handlers |

### 6. Storage Layer (`src/store/`)

SQLite database management with vector search.

| Module | Purpose |
|--------|---------|
| `db.ts` | Database connection, migrations, WAL mode |
| `nodes.ts` | Knowledge graph node CRUD |
| `edges.ts` | Knowledge graph edge CRUD |
| `vector.ts` | Vector storage and ANN search |
| `memory_store.ts` | Memory store abstraction |

### 7. Sync Layer (`src/sync/`)

CRDT-based cross-machine synchronization.

| Module | Purpose |
|--------|---------|
| `crdt.ts` | LWW + 2P-Set CRDT implementation |
| `transport.ts` | Folder and relay transport |

### 8. Tuner (`src/tuner/`)

SGD-based weight optimization for retrieval scoring.

---

## How Context Assembly Works

### The Retrieval Pipeline

Every `assemble_context` call goes through four scoring signals:

```
User Query
    │
    ├── Vector Similarity ─── cosine similarity via sqlite-vec ANN
    │                           (falls back to linear scan for <5k nodes)
    │
    ├── Graph Boost ─────────── BFS neighbor traversal
    │                           + import graph (DEPENDS_ON edges)
    │
    ├── AST-Aware Scoring ──── identifier extraction from query
    │                           matched against code skeletons
    │
    └── Recency Boost ──────── exponential decay: e^(-0.05 * hours)
                                favoring recently accessed nodes
    │
    ▼
Weighted Score = α·vector + β·graph + γ·ast + δ·recency

    │
    ▼
Top-N nodes within token budget → assembled context
```

### Context Assembly Modes

| Mode | Behavior |
|------|----------|
| **Fast** | Returns only titles/citations (budget-efficient) |
| **Full** | Returns complete code chunks and descriptions |

### Staleness Detection

Each node's `updated_at` is compared against the source file's mtime. Stale nodes are flagged for re-indexing.

---

## Session Lifecycle

```
Session Start
    │
    ├── Load QMS (restore previous session state)
    │
    ├── For each user prompt:
    │   ├── assemble_context(query, activeFile, budget)
    │   ├── inject context into prompt
    │   └── log conversation turn
    │
    ├── Session End:
    │   ├── Generate observations (async queue)
    │   ├── Generate session summary (async queue)
    │   ├── Save QMS snapshot
    │   └── Update embeddings
    │
    ▼
Next session starts from saved QMS
```

### Async Summarization Pipeline

When a session ends, observations are generated asynchronously:

1. `POST /api/sessions/trigger-summarize` enqueues a job
2. Background queue processor runs every 30 seconds
3. Gathers conversation turns from the session
4. Calls AI generation pipeline (local heuristics or LLM)
5. Stores results in `eidos_observations` and `eidos_summaries`
6. Updates vector embeddings for semantic search

**Summarizer backends:**

| Backend | Config Value | Behavior |
|---------|-------------|----------|
| Local | `local` | Heuristic extraction (no API call) |
| Ollama | `ollama:model` | Uses local Ollama instance |
| OpenAI | `openai:model` | Uses OpenAI API |

---

## Content Deduplication

Every observation and prompt is SHA-256 hashed before storage. If an identical record exists, insertion is skipped — preventing duplicates from consecutive similar sessions.

```
Content → SHA-256 → content_hash
                           │
                     EXISTS? ──Yes──→ Skip
                           │
                           No
                           │
                           ▼
                     Insert record
```

---

## Embedding Model

EidosCore uses **Xenova/all-MiniLM-L6-v2** (384-dim) via the `@xenova/transformers` library.

| Property | Value |
|----------|-------|
| Model | all-MiniLM-L6-v2 |
| Dimensions | 384 |
| Size | ~22 MB |
| Engine | WebGPU / WASM |
| Cache | `~/.eidos/models/` |
| Fallback | BGE-base if configured |

The model runs **entirely locally** — no external API calls for embeddings.

---

## Integration Methods

| Method | How It Works | Latency | CLIs |
|--------|-------------|---------|------|
| **Plugin** | Registers as native plugin with lifecycle hooks | Zero | Claude Code, OpenCode, OpenClaw |
| **Hook** | Writes hook configs calling `eidos hook <platform> <event>` | <5ms | Gemini CLI, Cursor, Windsurf |
| **MCP** | Writes MCP server config for direct tool access | <1ms | Claude Desktop, Qwen, VS Code, Continue, Roo Code, Copilot, Antigravity, Goose, Warp, Codex |

[→ Full integration guide](integrations.md)
[→ MCP tools reference](mcp-tools.md)
[→ API reference](api-reference.md)
