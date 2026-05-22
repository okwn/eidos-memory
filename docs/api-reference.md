# REST API Reference

The EidosCore daemon exposes an HTTP REST API at `http://localhost:7842`.

---

## Sessions & Observations

### `POST /api/sessions/init`

Create a new session.

```json
// Response
{ "session_id": "sess_abc123" }
```

### `POST /api/sessions/end`

End a session.

### `POST /api/sessions/observations`

Store an observation (dedup'd by content hash).

```json
{
  "session_id": "sess_abc123",
  "observation": {
    "title": "Bug found in calculator",
    "content": "Division by zero produces NaN",
    "tags": ["bug", "calc"]
  }
}
```

### `POST /api/sessions/summarize`

Create a session summary.

### `POST /api/sessions/trigger-summarize`

Enqueue an async summarization job.

### `GET /api/observations/by-file`

Get observations related to a specific file.

```
GET /api/observations/by-file?file=src/auth.ts&project=my-project
```

---

## Context & Search

### `GET /api/context/inject`

Full timeline context for a project.

```
GET /api/context/inject?project=my-project&budget=2000
```

### `POST /api/assemble`

Assemble context for a specific query.

```json
{
  "query": "explain the auth flow",
  "activeFile": "src/auth.ts",
  "budget": 2000
}
```

### `GET /api/search`

Hybrid memory search.

```
GET /api/search?q=database+connection&project=my-project&mode=semantic
```

**Modes:** `semantic`, `timeline`, `recent`

### `POST /api/prompts`

Record a user prompt (SHA-256 dedup'd).

### `GET /api/prompts/search`

Full-text search across all recorded prompts.

```
GET /api/prompts/search?q=authentication&project=my-project
```

---

## Dashboard & Monitoring

### `GET /api/health`

Health check with node count, active sessions, and uptime.

```json
{
  "status": "ok",
  "nodes": 1247,
  "active_sessions": 3,
  "uptime_seconds": 86400
}
```

### `GET /api/stats`

Full statistics: nodes, edges, feedback, weights, savings.

### `GET /api/graph`

Knowledge graph data (nodes + edges) for visualization.

### `GET /api/audit`

Last 50 audit log entries.

### `GET /api/lifetime`

Lifetime token/dollar savings.

### `GET /api/mcp-status`

MCP daemon status: PID, ports, connectivity.

---

## Configuration

The daemon port can be customized:

```bash
eidos dash -p 8080                    # custom dashboard port
eidos daemon start                    # uses defaults (7842)
```

---

## Example: Full Session Flow

```bash
# 1. Create session
curl -X POST http://localhost:7842/api/sessions/init
# → { "session_id": "sess_abc" }

# 2. Assemble context
curl -X POST http://localhost:7842/api/assemble \
  -H "Content-Type: application/json" \
  -d '{"query":"how does auth work?","budget":2000}'

# 3. Store observation
curl -X POST http://localhost:7842/api/sessions/observations \
  -H "Content-Type: application/json" \
  -d '{"session_id":"sess_abc","observation":{"title":"Auth flow documented","content":"Uses JWT + bcrypt"}}'

# 4. End session with summarization
curl -X POST http://localhost:7842/api/sessions/trigger-summarize \
  -H "Content-Type: application/json" \
  -d '{"session_id":"sess_abc"}'

# 5. Check health
curl http://localhost:7842/api/health
```
