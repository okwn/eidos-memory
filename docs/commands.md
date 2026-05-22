# CLI Commands Reference

EidosCore provides 20+ commands via the `eidos` CLI.

---

## Setup & Configuration

### `eidos connect [--all]`

**One-command setup** — detects all installed CLIs/IDEs, writes all configs, starts the daemon.

```bash
eidos connect
```

With `--all`, forces detection even for tools that appear missing.

### `eidos init [--global]`

Initialize a project: creates `.eidos/` directory, `eidos.config.json`, git hooks, and shell aliases.

```bash
eidos init              # current directory
eidos init --global     # also adds shell aliases
```

### `eidos setup`

Interactive first-time wizard: init + model download + doctor check.

### `eidos config [--fix]`

Validate and optionally fix `eidos.config.json`.

---

## Memory & Indexing

### `eidos index [path] [-l langs]`

Index a directory into the knowledge graph.

```bash
eidos index .                        # index current directory
eidos index src/ -l ts,js,py        # only TS, JS, and Python files
```

### `eidos status`

Show memory health: nodes, edges, staleness, disk usage, token savings.

### `eidos diff`

Show what changed in memory since the last session.

### `eidos stats [--watch] [--debug]`

Token savings dashboard. Use `--watch` for live monitoring.

### `eidos forget <query>`

Soft-delete a decision or fact from memory.

### `eidos prune`

Run decay pass: reduce importance of old nodes, archive cold ones.

### `eidos clear`

Clear this project's `.eidos` memory directory entirely.

---

## CLI Wrapping

### `eidos wrap <cli> [args]`

Inject memory into any CLI tool.

```bash
eidos wrap aider --model claude-sonnet
eidos wrap llm "explain this code"
```

### `eidos run <cli> [args]`

Smart alias for `wrap` — auto-detects the correct adapter.

### `eidos hook <platform> <event>`

**Stdio JSON hook handler** for IDE integrations. Reads JSON from stdin, writes JSON to stdout.

```bash
echo '{"session_id":"abc","prompt":"explain auth"}' | eidos hook cursor context
```

**Platforms:** `gemini`, `cursor`, `windsurf`

**Events:**

| Event | Description |
|-------|-------------|
| `session-init` | Creates a new session, returns `session_id` |
| `context` | Runs `assembleContext()`, returns context string |
| `observation` | Stores an observation (dedup'd by content hash) |
| `summarize` | Generates observations + summary, ends session |

---

## Sessions & Observations

### `eidos summarize`

Extract structured observations from conversation turns.

### `eidos replay <session-id>`

Replay a conversation session in the terminal.

### `eidos branch <meso-block-id> [new-session-id]`

Fork a new session from a checkpoint.

### `eidos export-qms <session-id> [out-file]`

Export Quantum Memory Seed to JSON.

### `eidos import-qms <file>`

Import a Quantum Memory Seed and pre-warm the cache.

---

## Daemon & Services

### `eidos daemon start`

Start the background daemon (MCP server + HTTP proxy + web dashboard).

### `eidos daemon stop`

Stop the running daemon.

### `eidos daemon status`

Show daemon status, PID, and active ports.

### `eidos dash [-p port]`

Open the web dashboard.

```bash
eidos dash                # port 7842
eidos dash -p 8080        # custom port
```

### `eidos proxy [-p port] [-u upstream]`

Start an OpenAI-compatible HTTP proxy with memory injection.

```bash
eidos proxy -p 4141 -u https://api.openai.com/v1
```

---

## MCP Server

### `eidos mcp start`

Start MCP server (stdio transport).

### `eidos mcp print-config [--client] [--copy]`

Print or auto-write MCP client configuration.

```bash
eidos mcp print-config --client claude-desktop --copy
```

### `eidos mcp test [--all] [--tool]`

Test MCP tools via JSON-RPC.

```bash
eidos mcp test --all
eidos mcp test --tool search_memory
```

---

## Maintenance

### `eidos doctor`

11-point health check:

```bash
eidos doctor
  ✔ Node.js                v22.3.0
  ✔ better-sqlite3         connected
  ✔ sqlite-vec             available
  ✔ WASM grammars          loaded
  ✔ Embedding model        cached
  ✔ ~/.eidos directory     writable
  ✔ Adapters               valid
  ✔ eidos.config.json      valid
  ✔ git                    available
  ✔ Daemon                 running
  ✔ MCP bridge             connected
```

### `eidos nightly`

SGD weight tuning + memory decay pass (runs automatically at 2am).

### `eidos version`

Show version and component status.

### `eidos update`

Check for updates and show upgrade path.

### `eidos download-model`

Pre-download the embedding model (~22 MB) for offline use.

```bash
eidos download-model
```

---

## Advanced

### `eidos workspaces list|switch|remove`

Multi-project workspace management.

### `eidos adapter install|list`

Manage CLI adapter configs.

### `eidos sync --folder <path>`

Sync knowledge graph to a shared folder (CRDT-based).

### `eidos sync --relay <url>`

Sync via relay server (CRDT-based, AES-256-GCM encrypted).

### `eidos telemetry on|off|status`

Manage opt-in anonymous telemetry.

### `eidos demo`

Interactive demo showing token savings in action.

```bash
eidos demo
```

### `eidos mcp pid`

Print daemon PID if running.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Daemon not running |
| 4 | Configuration error |
