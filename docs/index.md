# ⚡ EidosCore Documentation

Welcome to the EidosCore documentation. EidosCore is a local-first knowledge graph engine that gives AI CLIs persistent memory across sessions.

---

## 📋 Table of Contents

| Section | Description |
|---------|-------------|
| [Getting Started](getting-started.md) | Installation, setup, first run |
| [CLI Commands](commands.md) | Complete reference for all 20+ commands |
| [Architecture](architecture.md) | How EidosCore works under the hood |
| [MCP Tools](mcp-tools.md) | All 16 MCP tools with examples |
| [API Reference](api-reference.md) | REST API endpoints and usage |
| [Integrations](integrations.md) | CLI/IDE integration methods |
| [Configuration](configuration.md) | Config file, env vars, tuning |
| [Database](database.md) | SQLite schema documentation |
| [Privacy & Security](privacy.md) | Local-first design, redaction, firewall |
| [Development](development.md) | Contributing, building, testing |

---

## 🎯 What is EidosCore?

EidosCore is a **persistent memory layer** for AI coding assistants. It:

1. **Indexes** your codebase locally (Tree-sitter AST + embeddings)
2. **Stores** decisions, bugs, observations in a knowledge graph
3. **Injects** relevant context into every AI prompt
4. **Resumes** sessions exactly where you left off

All data stays on your machine — no cloud, no API calls for core functionality.

---

## 🚀 At a Glance

```bash
npm install -g eidos-memory
eidos connect          # detects all CLIs, writes configs, starts daemon
```

[→ Get started](getting-started.md)

---

## 🔗 Quick Links

- [GitHub Repository](https://github.com/sairajbaman/eidos-memory)
- [Website](https://eidosmemory.vercel.app)
- [npm Package](https://www.npmjs.com/package/eidos-memory)
- [Issue Tracker](https://github.com/sairajbaman/eidos-memory/issues)
- [Changelog](../CHANGELOG.md)
