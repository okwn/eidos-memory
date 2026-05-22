# Changelog

## 0.3.0 (2026-05-21)

### Documentation
- Rewrote README.md to be concise and scannable — moved detailed docs to `docs/` directory
- Added 11 comprehensive documentation files:
  - `docs/getting-started.md` — Installation and quick start guide
  - `docs/commands.md` — Full CLI commands reference
  - `docs/architecture.md` — Deep dive into how EidosCore works
  - `docs/mcp-tools.md` — All 16 MCP tools with examples
  - `docs/api-reference.md` — REST API endpoint reference
  - `docs/integrations.md` — CLI/IDE integration methods
  - `docs/configuration.md` — Config file and env vars reference
  - `docs/database.md` — SQLite schema documentation
  - `docs/development.md` — Contributing and development guide
  - `docs/privacy.md` — Privacy and security details
- Added `docs/` to npm package files list
- Added Docs links to site Navbar and Footer

All notable changes to EidosCore are documented here.
Format: [Semantic Versioning](https://semver.org)

## [0.2.0] — 2026-05-21

### Added
- **`eidos connect`** — Universal one-command installer that detects and configures 16 CLIs/IDEs
  - Claude Code (native plugin system)
  - Claude Desktop (MCP)
  - Qwen Code (MCP + permissions)
  - Gemini CLI (hooks + GEMINI.md context)
  - Cursor (hooks + MCP + rules)
  - Windsurf (hooks + rules)
  - Codex CLI (MCP)
  - OpenCode (plugin + AGENTS.md)
  - OpenClaw (extension)
  - Roo Code (MCP)
  - Copilot CLI (MCP)
  - Continue.dev (MCP)
  - VS Code (MCP)
  - Antigravity (MCP)
  - Goose (MCP)
  - Warp (MCP)
- **Per-project `.eidos/` directory** — memory lives with the code, not in `~/.eidos/<hash>/`
- **Auto-init on first use** — `assemble_context` runs full synchronous index on first call
- **Session resume via QMS** — auto-generate on session end, auto-load on session start
- **Structured observations** — `remember` stores title, narrative, facts, files_read, files_modified
- **`get_observation` tool** — get full details of a specific memory with linked nodes
- **`list_recent` tool** — list recent memories chronologically
- **`search_memory` modes** — semantic, timeline, and recent search
- **Session tracking** — `eidos_sessions` table with platform source (qwen/claude/gemini)
- **Structured memory tables** — `eidos_observations`, `eidos_summaries`, `eidos_prompts` with FTS5
- **`eidos summarize`** — extract structured observations from conversation turns
- **`eidos status`** — memory health dashboard: nodes, staleness, disk usage, savings
- **`eidos diff`** — show what changed since last session
- **`eidos forget <query>`** — semantic search + interactive soft-delete
- **`eidos prune`** — run decay pass, archive cold nodes
- **`eidos clear`** — reset project memory
- **Shell prompt indicator** — `[eidos]` in PS1 when `.eidos/` exists in cwd
- **Git post-checkout hook** — auto-reindex on branch switch
- **Context window bar** — visual `[████░░░░] 2000/4000 tokens` with color coding
- **AST-aware retrieval** — extracts identifiers from query, matches against skeleton
- **Import graph traversal** — follows `DEPENDS_ON` edges from active file
- **Staleness detection** — checks file mtime vs node updated_at
- **Progressive disclosure** — fast mode (titles only) vs full mode (complete code)
- **Private tags** — `<private>content</private>` excluded from memory
- **Dedup** — `remember` checks for identical statements before storing
- **Implicit feedback** — re-search detection, context precision tracking
- **HTTP API** — `/api/context/inject`, `/api/sessions/*`, `/api/search`, `/api/health`
- **Background summarization** — `eidos summarize` with local/ollama/openai backends
- **Daemon enhancements** — nightly jobs at 2am, health monitoring (DB size)

### Fixed
- **Staleness bug** — `isNodeStale` used `require('fs')` in ESM module, now uses `import fs`
- **Staleness comparison** — was comparing against JSON properties, now uses DB column with 1s tolerance
- **Thin context** — showed only function signatures, now shows full code bodies
- **HTML indexing** — `.html` files now indexed via `<script>` tag extraction
- **Gemini path spaces** — `spawnSafe` now quotes binary paths with spaces on Windows
- **Missing `.bashrc`** — `eidos init` now creates both `.bashrc` and `.bash_profile`
- **Passthrough feedback** — `eidos wrap <cli>` now shows `[eidos] memory active` message
- **SYSTEM_PROMPT** — now wired as MCP `instructions` field, more forceful wording

### Changed
- **66 tests** (was 62) — added end-to-end session resume test + precision + re-search signals
- **16 MCP tools** (was 12) — added `get_observation`, `list_recent`
- **`getDbPath()`** — now uses `.eidos/memory.db` in project root (was `~/.eidos/<hash>/`)

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
