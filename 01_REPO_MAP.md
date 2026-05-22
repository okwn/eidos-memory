# 01_REPO_MAP.md — eidos-memory

## Project Overview
**eidos-memory** (aka EidosCore) — A local-first AI memory engine providing persistent context across sessions for AI coding assistants. NPM package: `eidos-memory`. Version 0.2.0. MIT license.

---

## Directory Structure

```
eidos-memory/
├── src/
│   ├── cli/           CLI commands (connect, wrap, init, doctor, daemon, stats, etc.)
│   ├── engine/        Core brain: retrieval, embedding, generation, summariser
│   │   ├── ingestion/   Chunking, differ, skeleton (AST-aware)
│   │   └── summariser/  Async observation/summary generation
│   ├── mcp/           MCP server + 16 tool handlers
│   │   └── tools/       14 individual tool implementations
│   ├── store/         SQLite DB: nodes, edges, vector search, memory store
│   ├── dashboard/     Web dashboard (localhost:7842)
│   ├── sync/          CRDT-based cross-machine sync
│   ├── tuner/         SGD weight optimization
│   └── types/         TypeScript type definitions
├── adapters/          Built-in CLI adapter configs (JSON)
│   ├── claude.json
│   ├── gemini.json
│   ├── cursor.json
│   ├── aider.json
│   ├── continue.json
│   ├── llm.json
│   ├── mods.json
│   ├── open-interpreter.json
│   ├── qwen.json
│   └── sgpt.json
├── browser-extension/  Browser extension for memory injection
├── vscode-extension/   VS Code extension
├── test/               Vitest test suites
├── docs/               Full documentation
│   ├── index.md           Documentation hub
│   ├── getting-started.md
│   ├── architecture.md   Detailed system design
│   ├── commands.md       20+ CLI commands reference
│   ├── mcp-tools.md      16 MCP tools reference
│   ├── api-reference.md
│   ├── configuration.md
│   ├── database.md
│   ├── integrations.md
│   ├── privacy.md
│   └── development.md
├── scripts/            Build/release scripts
├── .github/workflows/  CI/CD (ci.yml)
├── package.json        npm config, scripts, dependencies
├── tsconfig.json
├── vitest.config.ts
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md  Contributor Covenant v2.1
├── INSTALL.md          Full installation guide
└── LICENSE             MIT
```

---

## Architecture Summary

### CLI Layer (`src/cli/`)
Entry point using Commander.js. Key commands:
- `eidos connect` — Auto-detect CLIs, write configs, start daemon
- `eidos wrap <tool>` — Inject memory into any CLI tool
- `eidos init` — Project initialization
- `eidos doctor` — 11-point health check
- `eidos index` — Index project into knowledge graph
- `eidos status` — Show memory stats
- `eidos dash` — Start web dashboard
- `eidos mcp` — Run MCP server
- `eidos demo` — Live benchmarks

### Engine Layer (`src/engine/`)
The brain of EidosCore:
- `retrieval.ts` — Hybrid retrieval: vector + graph + AST + recency scoring
- `embedding.ts` — 384-dim embeddings via all-MiniLM-L6-v2 (local, no API calls)
- `generation.ts` — AI summarization/observation generation
- `essentials.ts` — Context assembly within token budget
- `intent.ts` — Query intent classification
- `privacy.ts` — Secret redaction, `<private>` tags, `.eidosignore`
- `tokens.ts` — Token counting (cl100k_base)
- `budget.ts` — Adaptive token budget management
- `decay.ts` — Importance decay
- `audit.ts` — Context assembly audit trail
- `telemetry.ts` — Anonymous opt-in usage telemetry
- `federation.ts` — Cross-instance memory federation
- `error_memory.ts` — Error pattern learning

### MCP Layer (`src/mcp/`)
Model Context Protocol server exposing 16 tools:
| Tool | Category | Purpose |
|------|----------|---------|
| `assemble_context` | Context | Build optimal context within token budget |
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
| `feedback` | Utility | Rate quality (1-5) for SGD tuning |

### Storage Layer (`src/store/`)
- `db.ts` — Database connection, migrations, WAL mode
- `nodes.ts` — Knowledge graph node CRUD
- `edges.ts` — Knowledge graph edge CRUD
- `vector.ts` — Vector storage and ANN search (sqlite-vec)
- `memory_store.ts` — Memory store abstraction

---

## Integration Methods

| Method | Latency | Platforms |
|--------|---------|----------|
| **Plugin** | Zero | Claude Code, OpenCode, OpenClaw |
| **Hook** | <5ms | Gemini CLI, Cursor, Windsurf |
| **MCP** | <1ms | Claude Desktop, Qwen, VS Code, Continue, Roo Code, Copilot, Antigravity, Goose, Warp, Codex |

---

## Tech Stack
- **Runtime:** Node.js ≥ 20
- **Language:** TypeScript 5.5
- **Database:** SQLite + WAL mode + sqlite-vec (ANN vector search)
- **Embeddings:** all-MiniLM-L6-v2 (384-dim) via @xenova/transformers (local, ~22MB)
- **AST Parsing:** tree-sitter-wasms + web-tree-sitter
- **MCP:** @modelcontextprotocol/sdk
- **Token Counting:** js-tiktoken (cl100k_base)
- **Testing:** Vitest
- **CLI:** Commander.js
- **Sync:** CRDT (LWW + 2P-Set)

---

## Key Configuration Files
- `.env.example` — Environment variable template
- `eidos.config.json` — Project-level config (created by `eidos init`)
- `~/.eidos/` — Global EidosCore data directory (models, configs, databases)
- `.eidosignore` — Files/directories to exclude from indexing

---

## npm Scripts
| Script | Purpose |
|--------|---------|
| `build` | TypeScript compile + copy dashboard assets |
| `clean` | Remove dist/ |
| `dev` | TypeScript watch mode |
| `test` | Vitest test runner |
| `test:watch` | Vitest watch mode |
| `test:coverage` | With coverage report |
| `start` | Run CLI directly |
| `mcp` | Run MCP server |
| `dash` | Start web dashboard |
| `nightly` | Run nightly maintenance |
| `doctor` | (via CLI) Health check |
| `demo` | Live benchmarks |
| `release` | Release script (minor/major) |

---

## CI/CD
- **Workflow:** `.github/workflows/ci.yml`
- **Trigger:** Push to `main`/`dev`, PRs to `main`/`dev`
- **Matrix:** Node 20.x, 22.x, 24.x × Ubuntu, macOS, Windows
- **Steps:** npm ci → audit → type check → build → test → doctor check
- **Model cache:** HuggingFace cache restored on CI for embedding model