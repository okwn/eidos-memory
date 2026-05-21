# ⚡ EidosCore — Universal AI Memory Engine

[![npm version](https://img.shields.io/npm/v/eidos-memory?color=6366f1&label=npm)](https://www.npmjs.com/package/eidos-memory)
[![tests](https://img.shields.io/badge/tests-106%20passing-10b981)](https://github.com/sairajbaman/eidos-memory)
[![CI](https://github.com/sairajbaman/eidos-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/sairajbaman/eidos-memory/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

> **Your AI remembers everything.** EidosCore is a local-first knowledge graph that gives any AI CLI persistent memory across sessions — automatically.

```
  Without EidosCore:  AI forgets everything between sessions
  With EidosCore:     AI remembers decisions, code, bugs, and context forever
```

---

## ✨ What EidosCore Does

- **One-command setup** — `eidos connect` detects 16 CLIs/IDEs, writes all configs, and starts the background daemon
- **Per-project memory** — `.eidos/` directory lives with your code, travels with it
- **Auto-index** — first `assemble_context` call indexes the entire project synchronously via Tree-sitter AST
- **Session resume** — AI picks up exactly where you left off via QMS (Quantum Memory Seed)
- **Structured observations** — decisions, bugs, code changes stored with title, narrative, facts, files
- **AI summarization** — auto-generates observations and summaries after each session (local or LLM)
- **Hybrid retrieval** — vector search + graph traversal + AST-aware scoring + recency boost
- **16 MCP tools** — `assemble_context`, `search_memory`, `remember`, `get_observation`, `list_recent`, and more
- **Stdio hook handler** — `eidos hook` for Gemini CLI, Cursor, Windsurf hook-based integrations
- **HTTP REST API** — `/api/context/inject`, `/api/sessions/*`, `/api/search`, `/api/health`
- **Async summarization queue** — `pending_messages` table with background processor (non-blocking)
- **Content deduplication** — SHA-256 hashing prevents duplicate observations and prompts
- **20+ CLI commands** — `connect`, `hook`, `wrap`, `status`, `diff`, `stats`, `doctor`, `dash`, and more
- **Local-first** — all data stays on your machine, no cloud required
- **Privacy firewall** — `.eidosignore` + secret redaction + `<private>` tags

---

## 🚀 Quick Start — 30 seconds

```bash
# Install:
npm install -g eidos-memory

# One-command setup (detects all CLIs, writes configs, starts daemon):
eidos connect

# Restart your CLIs, then ask any question:
qwen "what was I working on?"
claude "explain the auth flow"
gemini "find bugs in the calculator"
```

That's it. EidosCore auto-indexes on first use, injects context automatically, and generates observations after every session.

---

## 📦 Installation

```bash
npm install -g eidos-memory
eidos connect         # auto-detect + configure all CLIs + start daemon
eidos status          # check memory health
```

**Requirements:** Node ≥ 20, npm ≥ 9

---

## 🔌 `eidos connect` — Universal CLI Integration

One command does everything: detects installed CLIs/IDEs, writes all integration files, starts the background daemon, and auto-indexes on first use.

```
eidos connect

  ✔ Claude Code       (plugin integration)
  ✔ Claude Desktop    (mcp integration)
  ✔ Qwen Code         (mcp integration)
  ✔ Gemini CLI        (hook integration)
  ✔ Cursor            (hook integration)
  ✔ Windsurf          (hook integration)
  ✔ Codex CLI         (mcp integration)
  ✔ OpenCode          (plugin integration)
  ✔ OpenClaw          (plugin integration)
  ✔ Roo Code          (mcp integration)
  ✔ Copilot CLI       (mcp integration)
  ✔ Continue.dev      (mcp integration)
  ✔ VS Code           (mcp integration)
  ✔ Antigravity       (mcp integration)
  ✔ Goose             (mcp integration)
  ✔ Warp              (mcp integration)

  Starting EidosCore daemon...
  ⚡ EidosCore daemon started
     PID   12345
     MCP   localhost:3742
     Proxy localhost:4141
     Dash  http://localhost:7842

  ✔ Eidos Connect complete!
```

### Integration Methods

| Method | CLIs | How It Works |
|--------|------|-------------|
| **Plugin** | Claude Code, OpenCode, OpenClaw | Registers as native plugin with lifecycle hooks |
| **Hook** | Gemini CLI, Cursor, Windsurf | Writes hook configs calling `eidos hook <platform> <event>` |
| **MCP** | Claude Desktop, Qwen, VS Code, Continue, Roo Code, Copilot, Antigravity, Goose, Warp, Codex | Writes MCP server config for direct tool access |

### Hook-Based Integrations

For CLIs that support hooks (Gemini CLI, Cursor, Windsurf), EidosCore writes hook configs that call the `eidos hook` stdio handler:

```json
{
  "BeforeAgent": [{
    "command": "eidos",
    "args": ["hook", "gemini", "context"],
    "timeout": 5000
  }],
  "AfterAgent": [{
    "command": "eidos",
    "args": ["hook", "gemini", "observation"],
    "timeout": 5000
  }],
  "OnSessionEnd": [{
    "command": "eidos",
    "args": ["hook", "gemini", "summarize"],
    "timeout": 15000
  }]
}
```

The hook handler reads JSON from stdin, normalizes it via platform adapter, performs the action, and writes JSON to stdout.

---

## 🛠 All Commands

### Setup & Configuration
| Command | Description |
|---------|-------------|
| `eidos connect [--all]` | **One-command setup**: detect all CLIs/IDEs, write configs, start daemon |
| `eidos init [--global]` | Initialize project: config, git hook, shell aliases, background index |
| `eidos setup` | Interactive first-time wizard: init + model download + doctor |
| `eidos config [--fix]` | Validate and optionally fix `eidos.config.json` |

### Memory & Indexing
| Command | Description |
|---------|-------------|
| `eidos index [path] [-l langs]` | Index a directory into the knowledge graph |
| `eidos status` | Show memory health: nodes, staleness, disk usage, savings |
| `eidos diff` | Show what changed in memory since last session |
| `eidos stats [--watch] [--debug]` | Token savings dashboard (live mode with `--watch`) |
| `eidos forget <query>` | Forget a decision or fact (soft-delete) |
| `eidos prune` | Run decay pass: reduce importance of old nodes, archive cold ones |
| `eidos clear` | Clear this project's `.eidos` memory directory |

### CLI Wrapping
| Command | Description |
|---------|-------------|
| `eidos wrap <cli> [args]` | Inject memory into any CLI tool |
| `eidos run <cli> [args]` | Smart alias for `wrap` — auto-detects adapter |
| `eidos hook <platform> <event>` | **Stdio JSON hook handler** for IDE integrations |

### Sessions & Observations
| Command | Description |
|---------|-------------|
| `eidos summarize` | Extract structured observations from conversation turns |
| `eidos replay <session-id>` | Replay a conversation session in the terminal |
| `eidos branch <meso-block-id> [new-session-id]` | Fork a new session from a checkpoint |
| `eidos export-qms <session-id> [out-file]` | Export Quantum Memory Seed to JSON |
| `eidos import-qms <file>` | Import a Quantum Memory Seed and pre-warm cache |

### Daemon & Services
| Command | Description |
|---------|-------------|
| `eidos daemon start` | Start background daemon (MCP + proxy + dashboard) |
| `eidos daemon stop` | Stop the running daemon |
| `eidos daemon status` | Show daemon status and ports |
| `eidos dash [-p port]` | Open web dashboard at `http://localhost:7842` |
| `eidos proxy [-p port] [-u upstream]` | Start OpenAI-compatible HTTP proxy with memory injection |

### MCP Server
| Command | Description |
|---------|-------------|
| `eidos mcp start` | Start MCP server (stdio transport) |
| `eidos mcp print-config [--client] [--copy]` | Print or auto-write MCP client config |
| `eidos mcp test [--all] [--tool]` | Test MCP tools via JSON-RPC |

### Maintenance
| Command | Description |
|---------|-------------|
| `eidos doctor` | 11-point health check: Node, SQLite, WASM, embeddings, config |
| `eidos nightly` | SGD weight tuning + memory decay pass |
| `eidos version` | Show version and component status |
| `eidos update` | Check for updates and show upgrade path |
| `eidos download-model` | Pre-download embedding model (~22 MB) for offline use |

### Advanced
| Command | Description |
|---------|-------------|
| `eidos workspaces list/switch/remove` | Multi-project workspace management |
| `eidos adapter install/list` | Manage CLI adapter configs |
| `eidos sync --folder <path>` | Sync knowledge graph to shared folder (CRDT) |
| `eidos sync --relay <url>` | Sync via relay server (CRDT) |
| `eidos telemetry on/off/status` | Manage opt-in anonymous telemetry |
| `eidos demo` | Interactive demo showing token savings in action |
| `eidos mcp pid` | Print daemon PID if running |

---

## 🎣 `eidos hook` — Stdio JSON Hook Handler

The backbone for all hook-based integrations. Reads JSON from stdin, performs the requested action, writes JSON to stdout.

```bash
eidos hook <platform> <event>
```

**Platforms:** `gemini`, `cursor`, `windsurf`

**Events:**
| Event | Action |
|-------|--------|
| `session-init` | Creates a new session, returns `session_id` |
| `context` | Runs `assembleContext()`, returns assembled context string |
| `observation` | Stores an observation in `eidos_observations` (dedup'd) |
| `summarize` | Generates observations + summary via AI pipeline, ends session |

**Example — manual invocation:**

```bash
echo '{"session_id":"abc","prompt":"explain auth flow"}' | eidos hook cursor context
# → {"ok":true,"context":"[CODE CONTEXT]\n  - function authenticate...","tokens":450}
```

---

## 🌐 HTTP REST API

The daemon exposes a REST API at `http://localhost:7842`:

### Sessions & Observations
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions/init` | POST | Create a new session → `{ session_id }` |
| `/api/sessions/end` | POST | End a session |
| `/api/sessions/observations` | POST | Store an observation (dedup'd by content hash) |
| `/api/sessions/summarize` | POST | Create a session summary |
| `/api/sessions/trigger-summarize` | POST | Enqueue async summarization job |
| `/api/observations/by-file?file=X&project=X` | GET | Get observations related to a file |

### Context & Search
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/context/inject?project=X&budget=N` | GET | Full timeline context for a project |
| `/api/assemble` | POST | Assemble context for a query (`{ query, activeFile, budget }`) |
| `/api/search?q=...&project=X&mode=semantic` | GET | Hybrid memory search |
| `/api/prompts` | POST | Record a user prompt (dedup'd) |
| `/api/prompts/search?q=...&project=X` | GET | Full-text search across prompts |

### Dashboard & Monitoring
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check: node count, active sessions, uptime |
| `/api/stats` | GET | Full stats: nodes, edges, feedback, weights, savings |
| `/api/graph` | GET | Knowledge graph data (nodes + edges) |
| `/api/audit` | GET | Last 50 audit log entries |
| `/api/lifetime` | GET | Lifetime token/dollar savings |
| `/api/mcp-status` | GET | MCP daemon status: PID, ports, connectivity |

### Async Summarization Pipeline

When a session ends, observations are generated **asynchronously**:

1. `POST /api/sessions/trigger-summarize` enqueues a job in `pending_messages`
2. Background queue processor runs every 30 seconds
3. Gathers conversation turns from the session
4. Calls the AI generation pipeline (`generateObservations` + `generateSessionSummary`)
5. Stores results in `eidos_observations` and `eidos_summaries`
6. Updates vector embeddings for semantic search

**Summarizer backends:** `local` (heuristic), `ollama:<model>`, `openai:<model>`

---

## 🧠 How It Works

### Architecture

```
eidos connect
  ├── Detects 16 CLIs/IDEs
  ├── Writes MCP configs (JSON) for MCP-based CLIs
  ├── Writes hook files (calling eidos hook) for hook-based CLIs
  ├── Registers plugins for plugin-based CLIs
  ├── Starts background daemon (HTTP API + MCP bridge)
  └── Done

eidos hook <platform> <event>
  ├── Reads JSON from stdin
  ├── Normalizes payload via platform adapter
  ├── Routes to handler: context | observation | summarize
  └── Writes JSON response to stdout

Daemon (persistent, port 7842)
  ├── HTTP REST API (all endpoints above)
  ├── MCP TCP bridge (port 3742)
  ├── HTTP proxy (port 4141)
  ├── Background summarization queue processor
  └── Nightly maintenance (2am: SGD tuning + decay)
```

### 1. Auto-Index on First Use
When you first call `assemble_context` in a project, EidosCore:
- Walks the directory tree
- Chunks code via Tree-sitter AST (10 languages: Python, TypeScript, JavaScript, Go, Rust, Java, C, C++, HTML)
- Generates 384-dim embeddings locally (no API calls, all-MiniLM-L6-v2 or BGE-base)
- Builds a knowledge graph with `DEPENDS_ON`, `CONTAINS`, `RELATES_TO` edges
- Saves a QMS snapshot for instant session resume

### 2. Hybrid Retrieval
Every context assembly uses four scoring signals:
- **Vector similarity** — cosine similarity via sqlite-vec ANN (falls back to linear scan)
- **Graph boost** — neighbour traversal (BFS) + import graph (`DEPENDS_ON` edges)
- **AST-aware scoring** — extracts identifiers from query, matches against code skeletons
- **Recency boost** — exponential decay `e^(-0.05 * hours)` favoring recently accessed nodes
- **Staleness detection** — compares file mtime vs node `updated_at`

### 3. Context Injection
Every AI prompt gets enriched with:
- **Relevant code chunks** (matched by hybrid retrieval)
- **Saved decisions** (from `remember` tool)
- **Recent changes** (file modifications, git commits)
- **Session history** (last 3 conversation turns)
- **Progressive disclosure** — fast mode (titles only) vs full mode (complete code)

### 4. Session Resume via QMS
When you restart a CLI:
- QMS (Quantum Memory Seed) restores the previous session's cognitive state
- Top-50 most relevant nodes pre-warmed in the cache
- AI picks up exactly where you left off

### 5. Structured Observations & AI Summarization
EidosCore extracts structured data from conversations:
- **Decisions**: "Use bcrypt for password hashing"
- **Code changes**: "Modified src/auth.ts"
- **Bugs found**: "Division by zero produces NaN"
- **Concepts**: JWT, OAuth, REST, React, TypeScript

After each session, the summarization pipeline:
1. Gathers conversation turns
2. Strips `<private>` tags
3. Calls the configured LLM (or local heuristics) with a structured extraction prompt
4. Parses JSON response into title, narrative, facts, concepts, files
5. Stores in `eidos_observations` with content deduplication
6. Updates vector embeddings for semantic search

### 6. Content Deduplication
Every observation and prompt is hashed (SHA-256) before storage. If an identical record exists, insertion is skipped — preventing duplicates from consecutive similar sessions.

---

## 🔧 MCP Tools (16 total)

| Tool | Purpose |
|------|---------|
| `assemble_context` | Build optimal context block within token budget |
| `search_memory` | Semantic/timeline/recent search across memories |
| `remember` | Store a decision, fact, or observation (dedup'd) |
| `get_observation` | Get full details of a specific memory with linked nodes |
| `list_recent` | List recent memories chronologically |
| `log_conversation` | Store a conversation turn (auto-generates micro-summary) |
| `generate_qms` | Save session snapshot (Quantum Memory Seed) |
| `load_qms` | Restore session state from QMS |
| `feedback` | Rate context assembly quality (1-5) — feeds SGD tuner |
| `index_project` | Index a directory into the knowledge graph |
| `update_file` | Re-index a single file (compute diff vs stored version) |
| `get_context_delta` | Return only new context since last `assemble_context` call |
| `compress_text` | Compress via skeleton extraction, diff, or summarization |
| `prefetch` | Pre-warm retrieval cache from IDE signals |

---

## 📁 Per-Project Memory

EidosCore stores memory in `.eidos/` inside your project:

```
my-project/
├── .eidos/
│   ├── memory.db          # SQLite database (nodes, edges, vectors, sessions, observations)
│   ├── audit.log          # Context assembly audit trail
│   └── models/            # Cached embedding model (~22 MB)
├── src/
│   └── ...
└── eidos.config.json      # Project configuration
```

- **Portable**: copy the project folder, you copy the memory
- **Isolated**: clearing one project never touches another
- **Visible**: you can see the `.eidos` folder, know it's working
- **Git-friendly**: add `.eidos/` to `.gitignore` or commit it for team memory

---

## ⚙️ Configuration

`eidos.config.json` (created automatically by `eidos init`):

```json
{
  "token_budget": 2000,
  "adaptive_budget": true,
  "auto_mode": true,
  "auto_index_on_connect": true,
  "auto_qms_on_session_end": true,
  "auto_assemble_on_prompt": true,
  "auto_log_conversations": true,
  "summariser": "local",
  "privacy_firewall": true,
  "decay_lambda": 0.05
}
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `EIDOS_WORKSPACE` | (auto-detect) | Override project workspace path |
| `EIDOS_NO_MEMORY` | — | Set to `1` to disable memory injection |
| `EIDOS_BUDGET` | `2000` | Default token budget for context assembly |
| `EIDOS_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model name |
| `TRANSFORMERS_CACHE` | `~/.eidos/models` | Cache directory for the embedding model |
| `EIDOS_SYNC_KEY` | — | AES-256-GCM key for cross-machine sync |
| `OPENAI_API_KEY` | — | API key for OpenAI summarizer backend |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama host for local LLM summarizer |
| `EIDOS_TELEMETRY` | — | Set to `1` to opt in to anonymous telemetry |
| `EIDOS_MCP_PORT` | `3742` | MCP TCP bridge port |
| `EIDOS_SUMMARISER` | `local` | Summarizer backend: `local`, `ollama:model`, `openai:model` |

---

## 🔒 Privacy

EidosCore is **local-first by design**:
- All data stored in `.eidos/memory.db` (per-project)
- `.eidosignore` excludes sensitive files (same syntax as `.gitignore`)
- Automatic secret redaction (API keys, JWTs, env vars)
- `<private>content</private>` tags exclude content from memory
- Privacy audit log at `.eidos/audit.log`
- Telemetry is **opt-in only** (`eidos telemetry on`)

---

## 🗄️ Database Schema

The SQLite database contains these tables:

| Table | Purpose |
|-------|---------|
| `nodes` | Knowledge graph nodes (chunks, files, decisions, conversation turns, QMS) |
| `edges` | Graph edges (`DEPENDS_ON`, `CONTAINS`, `RELATES_TO`) with weights |
| `vec_nodes` | Vector embeddings (sqlite-vec ANN, 384-dim float) |
| `sessions` | Session tracking with token savings |
| `eidos_sessions` | Structured session tracking (project, platform, status) |
| `eidos_observations` | Structured observations with content dedup (`content_hash`) |
| `eidos_summaries` | Session summaries (user requests, learnings, completed tasks) |
| `eidos_prompts` | User prompts with FTS5 full-text search and dedup |
| `pending_messages` | Async summarization job queue |
| `feedback` | Context quality ratings (1-5) for SGD tuning |
| `weights` | Retrieval weight values (tuned by SGD) |
| `lifetime_savings` | Persistent token/dollar savings counter |

---

## 🌐 Web Dashboard

```bash
eidos dash          # opens at http://localhost:7842
eidos daemon start  # starts dashboard + proxy + MCP bridge
```

The dashboard shows:
- **Live knowledge graph explorer** (vis-network force-directed graph)
- **Token savings charts** (Chart.js)
- **Retrieval weight sliders** (alpha, beta, gamma, delta, epsilon)
- **Audit log** (context assembly history)
- **MCP status** (daemon PID, ports, connectivity)

---

## 🧪 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js ≥ 20, TypeScript 5.5 (strict mode) |
| **Database** | SQLite via better-sqlite3 + WAL mode |
| **Vector Search** | sqlite-vec (ANN) → sqlite-vss (legacy) → linear cosine fallback |
| **Embeddings** | Xenova/all-MiniLM-L6-v2 (384-dim) via @xenova/transformers (WebGPU/WASM) |
| **AST Chunking** | Tree-sitter WASM grammars (Python, TS, JS, Go, Rust, Java, C, C++, HTML) |
| **MCP SDK** | @modelcontextprotocol/sdk v1.0 (stdio transport) |
| **Token Counting** | js-tiktoken (cl100k_base) |
| **CLI Framework** | Commander.js |
| **Testing** | Vitest (106 tests, 10 suites, 60s timeout) |
| **CI/CD** | GitHub Actions (Node 20/22, Ubuntu/macOS/Windows matrix) |
| **Sync** | CRDT-based (LWW + 2P-Set), AES-256-GCM encryption |
| **Dashboard** | vis-network + Chart.js, vanilla HTML/JS |

---

## 🧪 Development

```bash
git clone https://github.com/sairajbaman/eidos-memory
cd eidos-memory
npm install
npm run build
npm test          # 106 tests, all green
```

### Project Structure

```
src/
  cli/            CLI commands (connect, wrap, hook, init, stats, doctor, daemon…)
  commands/       Subcommands (clear, diff, forget, hook, status, summarize…)
  engine/         Core engine (embedding, retrieval, chunker, generation, privacy…)
  mcp/            MCP server + 14 tool handlers
  store/          SQLite DB, nodes, edges, vector search, memory store
  dashboard/      Web dashboard (HTTP server + REST API)
  tuner/          SGD weight tuning + nightly maintenance
  sync/           CRDT-based cross-machine sync
  types/          TypeScript declaration files
adapters/         Built-in CLI adapter configs (9 JSON files)
browser-extension/ Chrome extension (Manifest V3)
vscode-extension/ VS Code extension companion
test/             Vitest test suites (10 files, 106 tests)
```

### Release
```bash
npm run release          # patch bump → test → build → publish → tag
npm run release:minor    # minor bump
npm run release:major    # major bump
```

### Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md). All PRs require 106/106 tests passing and zero TS errors.

---

## 📄 License

MIT — see [LICENSE](LICENSE)