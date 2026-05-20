# Changelog

All notable changes to EidosCore are documented here.
Format: [Semantic Versioning](https://semver.org)

## [0.1.0] — 2026-05-20

### Added
- **Knowledge hypergraph** — SQLite-backed graph with nodes, edges, and vector search
- **sqlite-vec v0.1.9** — ANN vector search (replaces legacy sqlite-vss)
- **Hybrid retrieval** — cosine similarity + graph traversal + recency + SGD-tuned weights
- **AST code chunking** — tree-sitter WASM grammars for 30+ languages
- **MCP server** — 12 tools: `search_memory`, `assemble_context`, `log_conversation`, `remember`, `compress_text`, `prefetch`, `generate_qms`, `load_qms`, `feedback`, `index_project`, `update_file`, `get_context_delta`
- **CLI wrap mode** — universal adapter for any AI CLI (Claude, Gemini, Qwen, Aider, sgpt…)
  - Bidirectional: captures and logs both user + assistant turns
  - Interactive mode: stdin injection for Qwen-style CLIs
  - `--no-memory` flag for raw passthrough
- **Adapters** — 9 built-in adapters with `system_message`, `prepend`, `append`, `system_flag` injection
- **Lifetime savings** — persistent SQLite `lifetime_savings` table, survives restarts
- **Embedding model** — Xenova/all-MiniLM-L6-v2 (384-dim), optional BGE-base-en-v1.5 (768-dim)
  - Persistent cache at `~/.eidos/models` — never re-downloads
  - `eidos download-model` for pre-caching
- **Smart summariser** — local heuristic (first + longest + keyword sentence), no LLM required
- **Web dashboard** — force-directed graph, savings counter, audit log (`http://localhost:7842`)
- **Workspace manager** — `eidos workspaces list/switch/remove`, auto-registers on `eidos init`
- **`eidos doctor`** — 11/11 health checks with suggested fixes
- **`eidos setup`** — first-time setup wizard (init + model download + doctor)
- **`eidos stats --debug`** — shows raw DB path and lifetime_savings row
- **`eidos mcp test --all`** — JSON-RPC test harness for all 12 MCP tools
- **`eidos version`** / **`eidos update`** — version info and upgrade path
- **VS Code extension** — auto-starts daemon, status bar, workspace commands
- **Shell hooks** — global aliases via `eidos init --global` (bash/zsh/PowerShell)
- **Post-install hint** — prints `eidos setup` prompt after `npm install -g`
- **DEP0190 fix** — `shell: false` on Unix with `which`-based binary resolution
- **`eidos adapter list`** — shows built-in adapters with inject method, detect patterns
