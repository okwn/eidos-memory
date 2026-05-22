# 00_STATE.md — eidos-memory

## Fork Status
- **Source repo:** https://github.com/sairajbaman/eidos-memory
- **Fork:** https://github.com/okwn/eidos-memory
- **Forked:** 2026-05-22
- **Default branch:** `main`

## Repository Status
- **Archived:** No
- **License:** MIT (MIT License)
- **Language:** TypeScript
- **Created:** 2026-05-20
- **Stars:** 2
- **Forks:** 2 (including this fork)

## Quick Summary
EidosCore is a local-first knowledge graph engine that gives AI coding assistants (Claude, Gemini, Qwen, Cursor, Windsurf, VS Code, etc.) persistent memory across sessions. It achieves 95%+ token savings by storing memories, decisions, and code context locally and injecting only relevant context into prompts. Uses SQLite + sqlite-vec for hybrid vector/graph retrieval with 384-dim embeddings.

## Key Dependencies
- `@modelcontextprotocol/sdk`: MCP server
- `@xenova/transformers`: Local embedding model (all-MiniLM-L6-v2)
- `better-sqlite3`: SQLite bindings
- `sqlite-vec` / `sqlite-vss`: Vector search extensions
- `tree-sitter-wasms` / `web-tree-sitter`: AST parsing
- `js-tiktoken`: Token counting
- `commander`: CLI framework

## Dev Setup
```bash
npm install
npm run build
npm test           # 66 tests must pass
npx tsc --noEmit   # zero TypeScript errors
eidos doctor       # 11-point health check
```

## Branch Strategy
- `main` — stable, released code
- `dev` — active development (PRs target here)

## Local Paths
- Repository: `/root/oss-pr-campaign/repos/eidos-memory`
- Upstream: `https://github.com/sairajbaman/eidos-memory`
- Fork: `https://github.com/okwn/eidos-memory`