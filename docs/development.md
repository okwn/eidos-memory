# Development Guide

## Prerequisites

- Node.js ≥ 20
- npm ≥ 9
- Git

---

## Setup

```bash
git clone https://github.com/sairajbaman/eidos-memory
cd eidos-memory
npm install
npm run build
npm test          # 106 tests must pass
npm link          # makes `eidos` available globally
```

---

## Project Structure

```
src/
  cli/              CLI commands (connect, wrap, hook, init, stats, daemon…)
  commands/         Subcommands (clear, diff, forget, status…)
  engine/           Core engine (embedding, retrieval, chunker, generation…)
  mcp/              MCP server + 16 tool handlers
  store/            SQLite DB, nodes, edges, vector search, memory store
  dashboard/        Web dashboard (HTTP server + REST API)
  tuner/            SGD weight tuning + nightly maintenance
  sync/             CRDT-based cross-machine sync
adapters/           Built-in CLI adapter configs (9 JSON files)
browser-extension/  Chrome extension (Manifest V3)
vscode-extension/   VS Code extension companion
test/               Vitest test suites (106 tests, 10 suites)
docs/               Documentation
scripts/            Release scripts
```

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript, copy dashboard assets |
| `npm test` | Run all tests |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Test with coverage report |
| `npm run dev` | TypeScript watch mode |
| `npm run clean` | Remove dist/ |
| `npm run lint` | TypeScript type checking |

---

## Branch Strategy

- `main` — stable, released code
- `dev` — active development, PRs target here

---

## Before Opening a PR

1. **Run all tests** — `npm test` — 106/106 must pass
2. **Type check** — `npx tsc --noEmit` — zero errors
3. **Doctor check** — `eidos doctor` — 11/11 green
4. **Add tests** for any new behavior

---

## Code Style

- **TypeScript** strict mode (`strict: true`)
- **ES modules** (`"type": "module"` in package.json)
- **No unused locals/params** (`noUnusedLocals`, `noUnusedParameters`)
- **Async/await** over raw promises
- **JSDoc** for public API exports

---

## Testing

```bash
npm test                          # all tests
npx vitest run test/mcp.test.ts   # single test file
npx vitest run --reporter=verbose  # verbose output
```

### Test Suites

| File | Tests | Area |
|------|-------|------|
| `phase1.test.ts` | Basic memory operations | |
| `phase2.test.ts` | Session management | |
| `phase3.test.ts` | Context assembly | |
| `phase4.test.ts` | MCP integration | |
| `phase5.test.ts` | Sync + federation | |
| `mcp.test.ts` | MCP tools | |
| `dashboard.test.ts` | Dashboard API | |
| `edge-cases.test.ts` | Edge cases | |
| `stress.test.ts` | Performance benchmarks | |
| `e2e.test.ts` | End-to-end flows | |

---

## Adding a New Adapter

Create `adapters/<name>.json` following the schema in `adapters/claude.json`.

Supported injection methods: `prepend`, `append`, `system_message`, `system_flag`.

---

## Adding a New MCP Tool

1. Create `src/mcp/tools/<name>.ts`
2. Add tool definition to `src/mcp/tool_definitions.ts`
3. Register handler in `src/mcp/server.ts`
4. Add tests in `test/mcp.test.ts`

---

## Release

```bash
npm run release          # patch bump → test → build → publish → tag
npm run release:minor    # minor bump
npm run release:major    # major bump
```

---

## Reporting Issues

Open a GitHub issue with:
- OS and Node.js version
- `eidos doctor` output
- Minimal reproduction steps
