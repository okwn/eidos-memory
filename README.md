# ⚡ EidosCore — Universal AI Memory Engine

[![npm version](https://img.shields.io/npm/v/eidos-memory?color=6366f1\&label=npm)](https://www.npmjs.com/package/eidos-memory)
[![tests](https://img.shields.io/badge/tests-62%20passing-10b981)](https://github.com/sairajbaman/eidos-memory)
[![CI](https://github.com/sairajbaman/eidos-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/sairajbaman/eidos-memory/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

> **Save 95–98% of tokens on every AI prompt.** EidosCore is a local-first, privacy-respecting knowledge hypergraph that automatically injects relevant context into any AI CLI or MCP client — without changing a single line of your code.

```
  Without EidosCore:   4,200 tokens per prompt
  ✔ With EidosCore:      183 tokens
  ✔ Savings:             95.6%  (~$0.06 per prompt saved)
```

---

## ✨ Features

- **Universal** — works with Claude, Gemini, Aider, llm, sgpt, mods, open-interpreter, and any OpenAI-compatible client
- **Local-first** — all data stays on your machine in `~/.eidos/`
- **Privacy firewall** — `.eidosignore` + automatic secret redaction
- **Adaptive token budget** — intent-aware (debug / implement / recall / recap)
- **Vector search** — 384-dim MiniLM or optional 768-dim BGE embeddings with sqlite-vec ANN
- **CRDT sync** — AES-256-GCM encrypted team sync via shared folder or HTTP relay
- **Web dashboard** — vis-network graph explorer + savings charts at `localhost:7842`
- **VS Code extension** — live token savings in status bar + Memory Graph sidebar
- **MCP server** — 12 tools, works with Claude Desktop, Continue, Cursor, and more

---

## 🚀 Quick Start — 30 seconds

```bash
# Install from npm:
npm install -g eidos-memory

# First-time setup wizard (init + model download + health checks):
eidos setup

# Use with any AI CLI:
eidos wrap claude "explain the auth flow"
eidos run   aider  "fix the JWT expiry bug"   # smart alias, same thing

# Or use the MCP server (Claude Desktop, Cursor, Continue):
eidos mcp print-config --client claude-desktop --copy
```

That's it. Memory is now active for every `claude`, `aider`, `llm`, and `sgpt` invocation.

> **Install from source instead:**
> ```bash
> git clone https://github.com/eidos-memory/eidos-core && cd eidos-core
> npm install && npm run build && npm install -g .
> ```

---

## 📦 Installation

```bash
npm install -g eidos-memory
eidos setup           # first-time wizard: init + model + health checks
eidos --version       # should print 0.1.0
eidos doctor          # verify all 11 checks pass
```

> **Or install from source:**
> ```bash
> git clone https://github.com/eidos-memory/eidos-core
> cd eidos-core && npm install && npm run build && npm install -g .
> ```

**Requirements:** Node ≥ 20, npm ≥ 9

---

## 🛠 All Commands

| Command | Description |
|---------|-------------|
| `eidos init [--global]` | Zero-friction setup: config, git hook, shell aliases, background index |
| `eidos index [path]` | Index a project into the knowledge hypergraph |
| `eidos wrap <cli> [args]` | Inject memory into any CLI tool |
| `eidos run <cli> [args]` | Smart alias for `wrap` — auto-detects adapter |
| `eidos stats [--watch] [--debug]` | Show token savings (live with `--watch`, raw DB row with `--debug`) |
| `eidos doctor` | Health check: Node, SQLite, WASM, embeddings, config |
| `eidos demo` | Interactive demo — see the magic in 30 seconds |
| `eidos dash [-p port]` | Open web dashboard at localhost:7842 |
| `eidos daemon start/stop/status` | Background daemon (MCP + proxy + dashboard) |
| `eidos mcp [start]` | Start MCP server (stdio) |
| `eidos mcp print-config` | Print client config snippet for Claude/Continue/VS Code |
| `eidos proxy [-p port]` | OpenAI-compatible proxy with memory injection |
| `eidos sync --folder/--relay` | CRDT team sync (AES-256-GCM encrypted) |
| `eidos config [--fix]` | Validate + migrate eidos.config.json |
| `eidos export-qms / import-qms` | Quantum Memory Seeds for session portability |
| `eidos replay / branch` | Replay conversations, branch from checkpoints |
| `eidos nightly` | SGD tuning + memory decay pass |
| `eidos telemetry on/off/status` | Manage opt-in telemetry |
| `eidos setup` | First-time wizard: init + model download + doctor |
| `eidos download-model` | Pre-cache the embedding model offline |
| `eidos workspaces list/switch/remove` | Multi-project workspace manager |
| `eidos adapter list/install` | View built-in adapters and install to user dir |
| `eidos mcp test [--all]` | JSON-RPC test harness for all 12 MCP tools |
| `eidos version` | Version and component status |
| `eidos wrap --no-memory` | Raw passthrough — skip memory injection |

---

## 🔌 MCP Setup (Claude Desktop, Cursor, Continue)

### One-command setup
```bash
eidos mcp print-config --client claude-desktop --copy
# Writes directly to ~/Library/Application Support/Claude/claude_desktop_config.json
```

### Manual snippet
```json
{
  "mcpServers": {
    "eidos-memory": {
      "command": "eidos",
      "args": ["mcp"],
      "env": { "EIDOS_WORKSPACE": "/path/to/your/project" }
    }
  }
}
```

---

## 🌐 Web Dashboard

```bash
eidos dash          # opens at http://localhost:7842
eidos daemon start  # starts dashboard + proxy + MCP bridge in background
```

The dashboard shows:
- Live knowledge graph explorer (vis-network)
- Token savings bar chart + node type doughnut
- Retrieval weight sliders
- Audit log tail

---

## 🔒 Privacy

EidosCore is **local-first by design**:
- All data stored at `~/.eidos/<workspace-hash>/memory.db`
- `.eidosignore` excludes sensitive files (same syntax as `.gitignore`)
- Automatic secret redaction (API keys, JWTs, env vars)
- Privacy audit log at `~/.eidos/<hash>/audit.log`
- Opt-in telemetry (disabled by default): `eidos telemetry on`

---

## 🤝 Team Sync

```bash
# Shared folder (e.g. Dropbox/Google Drive):
eidos sync --folder /shared/team-memory --key "your-shared-secret"

# Self-hosted relay:
eidos sync --relay https://relay.yourteam.com --key "your-shared-secret"
```

Payloads are AES-256-GCM encrypted. The key never leaves your machine.

---

## 🧩 Supported Adapters

| Adapter | Install |
|---------|---------|
| `claude` (Anthropic) | `npm install -g @anthropic-ai/claude-cli` |
| `gemini` | `npm install -g @google/generative-ai-cli` |
| `aider` | `pip install aider-chat` |
| `llm` | `pip install llm` |
| `sgpt` | `pip install shell-gpt` |
| `mods` | `brew install charmbracelet/tap/mods` |
| `open-interpreter` | `pip install open-interpreter` |
| `qwen` | `pip install qwen-agent` |
| `continue` | VS Code extension: `continue.continue` |

---

## ⚙️ Configuration

`eidos.config.json` (created automatically by `eidos init`):

```json
{
  "token_budget": 2000,
  "adaptive_budget": true,
  "auto_index": true,
  "summariser": "local",
  "privacy_firewall": true,
  "adapters": ["claude", "gemini", "aider", "llm", "sgpt"],
  "decay_lambda": 0.05,
  "telemetry": false
}
```

Run `eidos config --fix` to validate and auto-migrate old configs.

---

## 🧪 Development

```bash
git clone https://github.com/sairajbaman/eidos-memory
cd eidos-memory
npm install
npm run build
npm test          # 62 tests, all green
npm run demo      # see it in action
eidos doctor      # 11/11 checks
```

### Optional: High-quality 768-dim embeddings
```bash
EIDOS_EMBEDDING_MODEL=bge-base eidos wrap claude "your query"
```
Add `"embedding_model": "bge-base"` to `eidos.config.json` to make it permanent.

### Release
```bash
npm run release          # patch bump → test → build → publish → tag
npm run release:minor    # minor bump
```

### Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md). All PRs require 62/62 tests passing and zero TS errors.

---

## 📄 License

MIT — see [LICENSE](LICENSE)
