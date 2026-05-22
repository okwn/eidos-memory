# Integrations Guide

EidosCore integrates with **17 AI CLIs and IDEs** using three methods: Plugin, Hook, and MCP.

---

## Integration Methods

| Method | Latency | How It Works |
|--------|---------|-------------|
| **Plugin** | Zero | Registers as native plugin with lifecycle hooks |
| **Hook** | <5ms | Writes hook configs calling `eidos hook <platform> <event>` |
| **MCP** | <1ms | Writes MCP server config for direct tool access |

---

## Supported Platforms

### Plugin-Based

| Platform | Config Written | 
|----------|---------------|
| **Claude Code** | `~/.claude/plugins/eidos-memory/` |
| **OpenCode** | Plugin registration |
| **OpenClaw** | Plugin registration |

### Hook-Based

| Platform | Config Written |
|----------|---------------|
| **Gemini CLI** | `~/.gemini/hooks.yml` |
| **Cursor** | `.cursor/hooks/` |
| **Windsurf** | `.windsurf/hooks/` |

Hook configs call `eidos hook <platform> <event>` with stdin/stdout JSON.

### MCP-Based

| Platform | Config Written |
|----------|---------------|
| **Claude Desktop** | `claude_desktop_config.json` |
| **Qwen Code** | MCP config |
| **VS Code** | `.vscode/mcp.json` |
| **Continue** | `~/.continue/config.json` |
| **Roo Code** | MCP config |
| **GitHub Copilot CLI** | MCP config |
| **Antigravity** | MCP config |
| **Goose** | MCP config |
| **Warp** | MCP config |
| **Codex CLI** | MCP config |

---

## Manual MCP Configuration

Add to your MCP client config:

```json
{
  "mcpServers": {
    "eidos-memory": {
      "command": "eidos",
      "args": ["mcp"],
      "env": {
        "EIDOS_WORKSPACE": "/absolute/path/to/your/project"
      }
    }
  }
}
```

### Convenience Commands

```bash
# Auto-write to Claude Desktop
eidos mcp print-config --client claude-desktop --copy

# Auto-write to Continue
eidos mcp print-config --client continue --copy

# Auto-write to VS Code
eidos mcp print-config --client vscode --copy
```

---

## Hook-Based Integration Details

Hook-based integrations use a JSON stdin/stdout protocol:

### Context Event

```bash
echo '{"session_id":"abc","prompt":"explain auth flow"}' | eidos hook cursor context
# → {"ok":true,"context":"[CODE CONTEXT]\n  - function authenticate...","tokens":450}
```

### Observation Event

```json
{
  "session_id": "abc",
  "title": "Fixed login bug",
  "content": "The login endpoint was missing input validation",
  "type": "code_change"
}
```

### Summarize Event

```json
{
  "session_id": "abc",
  "project": "my-project",
  "turns": [...]
}
```

---

## Plugin Integration Details

Plugin-based integrations register EidosCore as a native plugin with lifecycle hooks:

- **BeforeAgent**: Injects context before every prompt
- **AfterAgent**: Stores observations after each response
- **OnSessionEnd**: Triggers summarization when session ends

---

## Adapter Configuration

Custom adapters can be created in the `adapters/` directory:

```bash
adapters/
  claude.json
  gemini.json
  qwen.json
  aider.json
  llm.json
  sgpt.json
  mods.json
  open-interpreter.json
  continue.json
```

Each adapter defines the injection method and configuration for a specific CLI.
