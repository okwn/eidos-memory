# Configuration

EidosCore is configured via `eidos.config.json` (auto-created by `eidos init`) and environment variables.

---

## `eidos.config.json`

```json
{
  "token_budget": 2000,
  "adaptive_budget": true,
  "auto_mode": true,
  "auto_index_on_connect": true,
  "auto_qms_on_session_end": true,
  "auto_assemble_on_prompt": true,
  "auto_log_conversations": true,
  "summariser": "local",
  "privacy_firewall": true,
  "decay_lambda": 0.05
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token_budget` | number | 2000 | Max tokens for context assembly |
| `adaptive_budget` | boolean | true | Dynamically adjust budget based on query |
| `auto_mode` | boolean | true | Auto-detect fast/full context mode |
| `auto_index_on_connect` | boolean | true | Index project on first connect |
| `auto_qms_on_session_end` | boolean | true | Save QMS snapshot when session ends |
| `auto_assemble_on_prompt` | boolean | true | Auto-assemble context before each prompt |
| `auto_log_conversations` | boolean | true | Log conversation turns automatically |
| `summariser` | string | "local" | Backend: `local`, `ollama:model`, `openai:model` |
| `privacy_firewall` | boolean | true | Enable secret redaction and `.eidosignore` |
| `decay_lambda` | number | 0.05 | Exponential decay rate for memory importance |

---

## Environment Variables

Copy [`.env.example`](../.env.example) to `.env` and configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `EIDOS_WORKSPACE` | (auto-detect) | Override project workspace path |
| `EIDOS_NO_MEMORY` | — | Set to `1` to disable memory injection |
| `EIDOS_BUDGET` | `2000` | Default token budget for context assembly |
| `EIDOS_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model name |
| `TRANSFORMERS_CACHE` | `~/.eidos/models` | Cache directory for embedding model |
| `EIDOS_SYNC_KEY` | — | AES-256-GCM key for cross-machine sync |
| `OPENAI_API_KEY` | — | API key for OpenAI summarizer backend |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama host for local LLM summarizer |
| `EIDOS_TELEMETRY` | — | Set to `1` to opt in to anonymous telemetry |
| `EIDOS_MCP_PORT` | `3742` | MCP TCP bridge port |
| `EIDOS_SUMMARISER` | `local` | Summarizer backend override |

---

## Summarizer Backends

### Local (default)

Heuristic extraction — no API calls needed. Fast and private.

### Ollama

```bash
export EIDOS_SUMMARISER="ollama:llama3"
export OLLAMA_HOST="http://localhost:11434"
```

Uses a local Ollama model for AI-powered summarization.

### OpenAI

```bash
export EIDOS_SUMMARISER="openai:gpt-4o-mini"
export OPENAI_API_KEY="sk-..."
```

Uses OpenAI API for higher quality summarization.

---

## Project Memory Layout

```
my-project/
├── .eidos/
│   ├── memory.db          # SQLite database (all data)
│   ├── audit.log          # Context assembly audit trail
│   └── models/            # Cached embedding model (~22 MB)
├── .eidosignore           # Privacy exclusion rules
└── eidos.config.json      # Project configuration
```

---

## `.eidosignore`

Same syntax as `.gitignore`. Files matching patterns are excluded from indexing and memory.

```
# Sensitive files
.env
*.pem
secrets/
**/credentials*

# Generated files
dist/
build/
node_modules/
```
