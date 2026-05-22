# Phase 3 — Setup & Baseline: eidos-memory

## Repository Overview
- **Name:** eidos-memory (EidosCore)
- **Description:** Universal AI memory engine — 98% token savings, works with any CLI
- **Author:** sairajbaman
- **Version:** 0.2.0
- **Node.js requirement:** >=20.0.0
- **License:** MIT

## Project Structure
```
src/
├── cli/          # CLI commands (index, wrap, connect, daemon, etc.)
├── dashboard/    # Web dashboard (graph explorer at localhost:7842)
├── engine/      # Core logic: embedding, retrieval, budget, intent, tokens, etc.
├── mcp/         # Model Context Protocol server + 14 tools
├── store/       # SQLite DB layer (nodes, edges, vectors, db)
├── sync/        # CRDT sync (transport.ts, crdt.ts)
├── tuner/       # Nightly maintenance jobs + SGD tuning
└── types/       # TypeScript type definitions
test/            # 10 test files (106 tests total)
docs/            # 11 documentation files
adapters/        # Platform adapter configs
```

## Scripts (from package.json)
| Script | Command | Purpose |
|--------|---------|---------|
| `build` | `tsc && node -e "..."` | Compile TypeScript + copy dashboard/public |
| `dev` | `tsc --watch` | Watch mode |
| `test` | `vitest run` | Run test suite |
| `test:watch` | `vitest` | Watch mode |
| `test:coverage` | `vitest run --coverage` | Coverage report |
| `start` | `node dist/cli/index.js` | Run CLI |
| `mcp` | `node dist/mcp/server.js` | Run MCP server |
| `dash` | `node dist/cli/index.js dash` | Launch dashboard |
| `demo` | `node dist/cli/index.js demo` | Interactive demo |

**Note:** No `lint` or `typecheck` scripts defined — TypeScript compiler (`tsc`) is used for type checking via `build`.

## npm install
```
added 218 packages, and audited 219 packages in 8s
52 packages are looking for funding
5 moderate severity vulnerabilities (run npm audit fix --force)
```
✅ Successful — no blocking errors.

## npm test
```
✓ test/mcp.test.ts (12 tests) 450ms
✓ test/phase2.test.ts (12 tests) 1132ms
✓ test/e2e.test.ts (4 tests) 1010ms
✓ test/stress.test.ts (5 tests) 2939ms
✓ test/dashboard.test.ts (5 tests) 694ms
✓ test/phase1.test.ts (…)
✓ test/phase3.test.ts (…)
✓ test/phase4.test.ts (…)
✓ test/phase5.test.ts (…)
✓ test/edge-cases.test.ts (…)

Test Files  10 passed (10)
     Tests  106 passed (106)
Duration  14.85s (transform 545ms, setup 0ms, collect 359ms, tests 11.49s)
```
✅ All 106 tests pass. Test suite is healthy and fast.

## npm run build
```
> eidos-memory@0.2.0 build
> tsc && node -e "const fs=require('fs'),path=require('path');..."

[build] Copied dashboard/public → dist/dashboard/public
```
✅ TypeScript compilation succeeds. Custom post-build step copies static assets.

## Dependencies Analysis
**Key dependencies:**
- `@modelcontextprotocol/sdk` ^1.0.0 — MCP protocol
- `@xenova/transformers` ^2.17.2 — local embedding model (all-MiniLM-L6-v2)
- `better-sqlite3` ^11.0.0 — SQLite driver
- `sqlite-vec` ^0.1.9 — vector search (modern)
- `sqlite-vss` ^0.1.2 — vector search (legacy fallback)
- `tree-sitter-wasms` ^0.1.13 — AST parsing
- `web-tree-sitter` ^0.22.6 — Tree-sitter WASM bindings
- `js-tiktoken` ^1.0.15 — token counting
- `commander` ^12.1.0 — CLI framework

## GitHub Issues & PRs
- **Open issues:** 0
- **Open PRs:** 0
- gh CLI returned empty lists — may indicate rate limiting or repo not fully accessible via API

## Environment Info
- Working dir: `/root/oss-pr-campaign/repos/eidos-memory`
- TypeScript: 5.5.4
- Vitest: 2.1.1
- Node.js: 20+