# Contributing to EidosCore

Thank you for your interest in improving EidosCore!

## Quick Start

```bash
git clone https://github.com/sairajbaman/eidos-memory
cd eidos-memory
npm install
npm run build
npm test          # 66 tests must pass
npm install -g .  # install CLI locally
eidos doctor      # verify setup
```

## Branches

- `main` — stable, released code
- `dev`  — active development, PRs target here

## Before Opening a PR

1. Run `npm test` — all 66 tests must pass
2. Run `npx tsc --noEmit` — zero TypeScript errors
3. Run `eidos doctor` — 11/11 checks green
4. Add/update tests for any new behavior

## Adding a New Adapter

Create `adapters/<name>.json` following the schema in `adapters/claude.json`.
Supported injection methods: `prepend`, `append`, `system_message`, `system_flag`.

## Project Structure

```
src/
  cli/          CLI commands (wrap, init, stats, doctor…)
  engine/       Embedding, retrieval, summariser, chunker
  mcp/          MCP server + 12 tool handlers
  store/        SQLite DB, nodes, edges, vector search
  dashboard/    Web dashboard (http server + HTML)
  tuner/        SGD weight tuning + nightly maintenance
adapters/       Built-in CLI adapter configs (JSON)
test/           Vitest test suites
```

## Reporting Bugs

Open a GitHub issue with:
- OS and Node.js version
- `eidos doctor` output
- Minimal reproduction steps

## Contributors
- Documentation improvements (2026)
