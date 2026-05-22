# Privacy & Security

EidosCore is designed to be **local-first by default**. Your code and data never leave your machine unless you explicitly opt in.

---

## Local-First Design

- **All data stored locally** in `.eidos/memory.db` (per-project SQLite database)
- **Embeddings run locally** via `@xenova/transformers` (WebGPU/WASM) — no external API calls
- **No cloud dependency** for core functionality
- **Opt-in telemetry** — disabled by default

---

## Privacy Firewall

### `.eidosignore`

Same syntax as `.gitignore`. Excludes sensitive files from indexing:

```
# Sensitive files
.env
*.pem
secrets/
**/credentials*
**/*.key

# Generated files
dist/
build/
node_modules/
```

### Secret Redaction

EidosCore automatically detects and redacts common secrets:

- API keys (`sk-...`, `pk-...`)
- JWTs
- Private keys
- Database connection strings
- Environment variable values

### `<private>` Tags

Wrap any content in `<private>` tags to exclude it from memory:

```
The database password is <private>s3cr3t</private>
```

The tag and its content are stripped before storage.

---

## Data Storage

All data is stored in per-project `.eidos/` directories:

```
.my-project/
├── .eidos/
│   ├── memory.db       # SQLite with SQLCipher-compatible schema
│   ├── audit.log       # Context assembly audit trail
│   └── models/         # Cached embedding model (~22 MB)
```

### What Gets Stored

| Data | Stored? | Description |
|------|---------|-------------|
| Code embeddings | ✅ Yes | Vectors, not source — can't reconstruct code |
| File paths | ✅ Yes | Relative to project root |
| Conversation prompts | ✅ Yes | Content-hash dedup'd |
| Observations | ✅ Yes | Structured summaries |
| API keys/secrets | ❌ No | Auto-redacted |
| Git credentials | ❌ No | Not accessed |

---

## Audit Log

Every context assembly is logged to `.eidos/audit.log`:

```
[2026-05-21T10:30:00Z] assemble_context query="explain auth" tokens=450 nodes=12
[2026-05-21T10:30:05Z] remember title="Use bcrypt" hash=a1b2c3
```

---

## Sync Encryption

When using `eidos sync` for cross-machine memory, data is encrypted:

- **Algorithm**: AES-256-GCM
- **Key**: User-provided `EIDOS_SYNC_KEY` environment variable
- **Transport**: Optional relay server (user-configurable)

---

## Telemetry

**Disabled by default.** No data is sent anywhere unless you explicitly opt in:

```bash
eidos telemetry on      # opt in
eidos telemetry status  # check status
eidos telemetry off     # opt out
```

If enabled, only anonymous usage stats are collected (command counts, not code or prompts).

---

## Security Recommendations

1. **Add `.eidos/` to `.gitignore`** — unless you want team memory in the repo
2. **Review `.eidosignore`** — ensure all sensitive paths are excluded
3. **Use local summarizer** — the `local` backend requires no API calls
4. **Keep Node.js updated** — EidosCore requires ≥ 20, recommends LTS

---

## FAQ

**Q: Does EidosCore send my code to any server?**  
A: No. All processing is local. The only outbound connections are: (1) embedding model download (~22 MB, one-time), and (2) optional LLM summarizer if configured.

**Q: Can I use EidosCore offline?**  
A: Yes. After the initial model download, everything runs offline.

**Q: What happens when I uninstall?**  
A: Run `npm uninstall -g eidos-memory` and delete `~/.eidos/`. Shell hooks can be removed from `~/.bashrc`/`~/.zshrc`.
