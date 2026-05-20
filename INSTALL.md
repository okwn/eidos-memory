# EidosCore Installation Guide

## Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Node.js | 20.0.0 | 22 LTS |
| npm | 9.0.0 | 10+ |
| OS | macOS 12, Ubuntu 20, Windows 10 | Latest |
| Disk | 200 MB | 1 GB (for embedding cache) |

---

## Option 1 — Global npm install (recommended)

```bash
npm install -g eidos-memory
eidos doctor          # verify everything is working
eidos init --global   # one-command full setup
```

## Option 2 — npx (no install)

```bash
npx eidos-memory doctor
npx eidos-memory demo
npx eidos-memory init --global
```

## Option 3 — From source

```bash
git clone https://github.com/eidos-memory/eidos-core
cd eidos-core
npm install
npm run build
npm link              # makes `eidos` available globally
```

---

## Platform-specific notes

### macOS / Linux

After `eidos init --global`, your `~/.bashrc` or `~/.zshrc` is patched with:
- A `_eidos_wrap` shell function
- Aliases: `claude`, `gemini`, `aider`, `llm`, `sgpt` → `eidos wrap <tool>`

Restart your shell or run:
```bash
source ~/.bashrc   # bash
source ~/.zshrc    # zsh
```

### Windows (PowerShell)

After `eidos init --global`, your PowerShell profile (`$PROFILE`) is patched with
function wrappers for all detected AI CLIs.

Restart PowerShell, or run:
```powershell
. $PROFILE
```

### WSL / Windows Subsystem for Linux

Use the Linux install path inside WSL. The Windows PowerShell profile patch
is separate — run `eidos init --global` once inside WSL and once in PowerShell.

---

## First-time setup walkthrough

```
$ npm install -g eidos-memory
+ eidos-memory@0.1.0

$ cd ~/my-project

$ eidos init --global

  ⚡ EidosCore Init  /home/user/my-project

  · .eidosignore already exists
  ✔ Created eidos.config.json
  ✔ Git post-commit hook installed
  ✔ Shell profile patched (run: source ~/.bashrc)
  ✔ Background indexing started (eidos index /home/user/my-project)

  MCP config snippet — add to your client's config:
  ┌────────────────────────────────────────────────┐
  {
    "command": "eidos",
    "args": ["mcp"],
    "env": { "EIDOS_WORKSPACE": "/home/user/my-project" }
  }
  └────────────────────────────────────────────────┘

  ✔ EidosCore ready.
  Tip: Run eidos doctor to verify your setup.

$ eidos doctor

  ✔ Node.js                v22.3.0
  ✔ better-sqlite3         connected to :memory: successfully
  ⚠ sqlite-vss             not available — will use linear cosine fallback
  ✔ WASM grammars          tree-sitter-wasms/out/ present
  ⚠ Embedding model        cache not found — will auto-download ~22 MB on first use
  ✔ ~/.eidos directory     writable
  ✔ Adapters               8 adapters valid
  ✔ eidos.config.json      valid
  ✔ git                    available

  1 warning(s). EidosCore will work, some features may be limited.
```

---

## MCP client configuration

### Claude Desktop

```bash
eidos mcp print-config --client claude-desktop --copy
# Auto-writes to ~/Library/Application Support/Claude/claude_desktop_config.json
```

### Continue (VS Code)

```bash
eidos mcp print-config --client continue --copy
# Auto-writes to ~/.continue/config.json
```

### VS Code (native MCP)

```bash
eidos mcp print-config --client vscode --copy
# Auto-writes to .vscode/mcp.json in your project
```

### Manual (any client)

```json
{
  "mcpServers": {
    "eidos-memory": {
      "command": "eidos",
      "args": ["mcp"],
      "env": { "EIDOS_WORKSPACE": "/absolute/path/to/project" }
    }
  }
}
```

---

## VS Code Extension

```bash
cd vscode-extension
npm install
npm run compile
# Then install the extension folder in VS Code (Developer: Install Extension from Location)
```

The extension:
- Auto-starts the EidosCore daemon if not running
- Shows live token savings in the status bar
- Provides a Memory Graph tree view in the sidebar
- Adds "Show What Eidos Knows" to the right-click menu

---

## Troubleshooting

### `eidos: command not found`
```bash
npm install -g eidos-memory
# If still not found, add npm global bin to PATH:
export PATH="$(npm config get prefix)/bin:$PATH"
```

### Embedding model download fails
```bash
# Set a custom cache directory:
export TRANSFORMERS_CACHE=/your/cache/dir
eidos index .
```

### sqlite-vss not loading
This is a warning, not an error. EidosCore falls back to linear cosine similarity.
Vector search still works, just slightly slower on very large codebases (>50k nodes).

### `eidos doctor` shows failures
Run `eidos doctor` and follow the suggestions. Most issues are fixed by:
```bash
npm install -g eidos-memory   # re-install
node --version                 # ensure >= 20
```

---

## Uninstall

```bash
npm uninstall -g eidos-memory
rm -rf ~/.eidos               # removes all memory databases and config
```

To remove shell hooks, edit `~/.bashrc` or `~/.zshrc` and delete the
`# EidosCore memory injection` block.
