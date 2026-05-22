# Getting Started with EidosCore

## Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Node.js | 20.0.0 | 22 LTS |
| npm | 9.0.0 | 10+ |
| OS | macOS 12, Ubuntu 20, Windows 10 | Latest |
| Disk | 200 MB | 1 GB (embedding cache) |

## Installation

### Global install (recommended)

```bash
npm install -g eidos-memory
```

### Via npx (no install)

```bash
npx eidos-memory doctor
npx eidos-memory demo
npx eidos-memory init --global
```

### From source

```bash
git clone https://github.com/sairajbaman/eidos-memory
cd eidos-memory
npm install
npm run build
npm link
```

---

## Quick Start — 30 seconds

### 1. Connect everything

```bash
eidos connect
```

This single command:
- Detects all installed CLIs and IDEs (Claude, Gemini, Qwen, Cursor, VS Code, etc.)
- Writes all integration configs automatically
- Starts the background daemon (MCP + HTTP API + dashboard)
- Auto-indexes your project on first use

### 2. Verify it's working

```bash
eidos status
```

Shows memory health: node count, staleness, disk usage, token savings.

### 3. Restart your CLI

Close and reopen your AI CLI (Claude, Gemini, etc.). EidosCore now automatically:
- Injects relevant context before every prompt
- Stores observations after each session
- Generates summaries of what was discussed

---

## First-Time Setup Walkthrough

```
$ npm install -g eidos-memory
+ eidos-memory@0.2.0

$ cd ~/my-project

$ eidos connect
  ✔ Claude Code       (plugin)
  ✔ Claude Desktop    (mcp)
  ✔ Qwen Code         (mcp)
  ✔ Gemini CLI        (hook)
  ✔ Cursor            (hook)
  ✔ Windsurf          (hook)
  ✔ VS Code           (mcp)
  ... and 9 more

  ⚡ EidosCore daemon started
     PID   12345
     MCP   localhost:3742
     Dash  http://localhost:7842

  ✔ Eidos Connect complete!

$ eidos status
  ✔ Memory active
     Nodes:   1,247
     Edges:   3,891
     Savings: 94.2% tokens
```

---

## What Happens Next

| Event | What EidosCore Does |
|-------|---------------------|
| First `assemble_context` | Indexes entire project via Tree-sitter AST |
| Every prompt | Injects relevant code chunks + saved decisions |
| Session end | Generates structured observations |
| CLI restart | Restores session state via QMS (Quantum Memory Seed) |
| New code | Auto-detects changes, updates embeddings |

---

## Platform-Specific Notes

### macOS / Linux

Shell profile is patched with function wrappers and aliases. Restart shell or run:

```bash
source ~/.bashrc   # bash
source ~/.zshrc    # zsh
```

### Windows (PowerShell)

PowerShell profile (`$PROFILE`) is patched with function wrappers. Run:

```powershell
. $PROFILE
```

### WSL

Run `eidos init --global` once inside WSL and once in PowerShell — they're separate environments.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `eidos: command not found` | `export PATH="$(npm config get prefix)/bin:$PATH"` |
| Embedding download fails | `export TRANSFORMERS_CACHE=/your/cache/dir` |
| sqlite-vec not loading | Warning only — falls back to linear search |
| Doctor shows failures | Run `eidos doctor` for specific guidance |

[→ Full commands reference](commands.md)
[→ Configuration guide](configuration.md)
