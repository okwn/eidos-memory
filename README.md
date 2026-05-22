<div align="center">

# ⚡ EidosCore

**Your AI never forgets.**  
A local-first knowledge graph that gives any AI CLI persistent memory across sessions.

[![npm version](https://img.shields.io/npm/v/eidos-memory?color=6366f1&label=npm)](https://www.npmjs.com/package/eidos-memory)
[![tests](https://img.shields.io/badge/tests-106%20passing-10b981)](https://github.com/sairajbaman/eidos-memory)
[![CI](https://github.com/sairajbaman/eidos-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/sairajbaman/eidos-memory/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

[Install](#-quick-start) · [Docs](docs/index.md) · [Site](https://eidosmemory.vercel.app) · [API](docs/api-reference.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## 🚀 Quick Start

```bash
npm install -g eidos-memory
eidos connect          # detects all CLIs, writes configs, starts daemon
eidos status           # verify memory is working
```

That's it. Restart your CLI — EidosCore auto-indexes on first use and injects memory automatically.

---

## ✨ Core Features

| | |
|---|---|
| 🧠 Persistent Memory | AI remembers decisions, bugs, and context across sessions |
| 🔌 Universal | Works with Claude, Gemini, Qwen, Cursor, Windsurf, VS Code, and 10+ more |
| 🔒 Local-First | All data stays on your machine — `.eidos/` in your project folder |
| ⚡ Sub-10ms | Hybrid retrieval (vector + graph + AST) in milliseconds |
| 📉 95%+ Token Savings | Reuse context instead of re-sending it — saves $$ |
| 🌐 Web Dashboard | Visual knowledge graph explorer + live stats at `localhost:7842` |
| 🔄 Async Summarization | Auto-generates structured observations after each session |
| 📦 MCP Native | 16 tools via Model Context Protocol — works with any MCP client |

[→ Full feature details](docs/index.md)

---

## 🔌 Supported Platforms

**17 integrations** — one `eidos connect` configures them all:

| Method | Platforms |
|--------|-----------|
| **Plugin** | Claude Code, OpenCode, OpenClaw |
| **Hook** | Gemini CLI, Cursor, Windsurf |
| **MCP** | Claude Desktop, Qwen, VS Code, Continue, Roo Code, Copilot, Antigravity, Goose, Warp, Codex |

---

## 📖 Documentation

| Topic | Link |
|-------|------|
| Getting Started | [docs/getting-started.md](docs/getting-started.md) |
| CLI Commands (20+) | [docs/commands.md](docs/commands.md) |
| Architecture | [docs/architecture.md](docs/architecture.md) |
| MCP Tools (16) | [docs/mcp-tools.md](docs/mcp-tools.md) |
| REST API | [docs/api-reference.md](docs/api-reference.md) |
| Integrations Guide | [docs/integrations.md](docs/integrations.md) |
| Configuration | [docs/configuration.md](docs/configuration.md) |
| Database Schema | [docs/database.md](docs/database.md) |
| Privacy & Security | [docs/privacy.md](docs/privacy.md) |
| Development | [docs/development.md](docs/development.md) |

---

## Benchmarks

| Metric | Without Eidos | With Eidos | Savings |
|--------|:------------:|:---------:|:-------:|
| Tokens per prompt | 4,500 | 200 | **95.6%** |
| Cost per 100 prompts | $0.09 | $0.004 | **95.6%** |
| Context assembly | — | <10ms | — |
| Monthly savings/dev | — | ~$90 | **98%** |

*Run `eidos demo` to see live benchmarks on your machine.*

---

## Tech Stack

**Node.js ≥ 20** · **TypeScript 5.5** · **SQLite + WAL** · **sqlite-vec ANN** · **384-dim embeddings**  
**Tree-sitter AST** · **MCP SDK** · **js-tiktoken** · **Vitest** · **CRDT sync**

---

## License

MIT — see [LICENSE](LICENSE)
