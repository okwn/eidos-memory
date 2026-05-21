import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { c } from './spinner.js';
import { writeGeminiHooks, writeCursorHooks, writeWindsurfHooks } from './hook_writers.js';
import { startDaemon } from './daemon.js';

interface CliDetection {
  name: string;
  detected: boolean;
  method: 'wrap' | 'hook' | 'mcp' | 'plugin';
  configPath: string | null;
  install: () => void;
}

const EIDOS_MCP_SERVER = {
  command: process.platform === 'win32' ? 'eidos.cmd' : 'eidos',
  args: ['mcp'],
};

const EIDOS_TOOL_PERMISSIONS = [
  'mcp__eidos-memory__assemble_context',
  'mcp__eidos-memory__search_memory',
  'mcp__eidos-memory__remember',
  'mcp__eidos-memory__log_conversation',
  'mcp__eidos-memory__generate_qms',
  'mcp__eidos-memory__load_qms',
  'mcp__eidos-memory__index_project',
  'mcp__eidos-memory__feedback',
  'mcp__eidos-memory__get_context_delta',
  'mcp__eidos-memory__compress_text',
  'mcp__eidos-memory__prefetch',
  'mcp__eidos-memory__update_file',
  'mcp__eidos-memory__get_observation',
  'mcp__eidos-memory__list_recent',
];

function cmdExists(name: string): boolean {
  try {
    const which = process.platform === 'win32' ? 'where' : 'command -v';
    execSync(`${which} ${name} 2>nul`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function dirExists(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function fileExists(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function readJson(p: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

function writeJson(p: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof result[k] === 'object') {
      result[k] = deepMerge(result[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ── CLI Detectors ──────────────────────────────────────────────────────────

function detectClaude(): CliDetection {
  const home = os.homedir();
  const configDir = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'Claude')
    : process.platform === 'win32'
      ? path.join(home, 'AppData', 'Roaming', 'Claude')
      : path.join(home, '.config', 'Claude');
  const detected = dirExists(configDir);

  return {
    name: 'Claude Desktop',
    detected,
    method: 'mcp',
    configPath: detected ? path.join(configDir, 'claude_desktop_config.json') : null,
    install: () => {
      if (!detected) return;
      const cfgPath = path.join(configDir, 'claude_desktop_config.json');
      const existing = readJson(cfgPath);
      const merged = deepMerge(existing, { mcpServers: { 'eidos-memory': EIDOS_MCP_SERVER } });
      writeJson(cfgPath, merged);
    },
  };
}

function detectQwen(): CliDetection {
  const home = os.homedir();
  const configPath = path.join(home, '.qwen', 'settings.json');
  const detected = fileExists(configPath);

  return {
    name: 'Qwen Code',
    detected,
    method: 'mcp',
    configPath: detected ? configPath : null,
    install: () => {
      const cfgPath = path.join(home, '.qwen', 'settings.json');
      const existing = readJson(cfgPath);

      // Add Eidos MCP server
      const servers = (existing['mcpServers'] ?? {}) as Record<string, unknown>;
      servers['eidos-memory'] = EIDOS_MCP_SERVER;

      // Disable competing memory server
      if (servers['memory']) {
        (servers['memory'] as Record<string, unknown>)['_disabled'] = true;
      }

      // Merge permissions
      const perms = (existing['permissions'] ?? {}) as Record<string, unknown>;
      const allow = (perms['allow'] ?? []) as string[];
      const mergedAllow = [...new Set([...allow, ...EIDOS_TOOL_PERMISSIONS])];

      existing['mcpServers'] = servers;
      existing['permissions'] = { ...perms, allow: mergedAllow };

      writeJson(cfgPath, existing);
    },
  };
}

function detectGemini(): CliDetection {
  const home = os.homedir();
  const geminiDir = path.join(home, '.gemini');
  const detected = dirExists(geminiDir);

  return {
    name: 'Gemini CLI',
    detected,
    method: 'hook',
    configPath: detected ? path.join(geminiDir, 'settings.json') : null,
    install: () => {
      try {
        writeGeminiHooks();
      } catch (err) {
        console.error(`  ${c.red('✗')} Gemini hooks failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

function detectCursor(): CliDetection {
  const home = os.homedir();
  const cursorDir = path.join(home, '.cursor');
  const detected = dirExists(cursorDir);

  return {
    name: 'Cursor',
    detected,
    method: 'hook',
    configPath: detected ? path.join(cursorDir, 'hooks.json') : null,
    install: () => {
      try {
        writeCursorHooks();
      } catch (err) {
        console.error(`  ${c.red('✗')} Cursor hooks failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

function detectWindsurf(): CliDetection {
  const home = os.homedir();
  const windsurfDir = path.join(home, '.codeium', 'windsurf');
  const detected = dirExists(windsurfDir);

  return {
    name: 'Windsurf',
    detected,
    method: 'hook',
    configPath: detected ? path.join(windsurfDir, 'hooks.json') : null,
    install: () => {
      try {
        writeWindsurfHooks();
      } catch (err) {
        console.error(`  ${c.red('✗')} Windsurf hooks failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

function detectContinue(): CliDetection {
  const home = os.homedir();
  const configPath = path.join(home, '.continue', 'config.json');
  const detected = fileExists(configPath);

  return {
    name: 'Continue.dev',
    detected,
    method: 'mcp',
    configPath: detected ? configPath : null,
    install: () => {
      const existing = readJson(configPath);
      const merged = deepMerge(existing, {
        experimental: {
          modelContextProtocolServers: [{
            transport: { type: 'stdio', ...EIDOS_MCP_SERVER },
          }],
        },
      });
      writeJson(configPath, merged);
    },
  };
}

function detectVsCode(): CliDetection {
  const vscodeDir = path.join(process.cwd(), '.vscode');
  const detected = dirExists(vscodeDir) || cmdExists('code');

  return {
    name: 'VS Code',
    detected,
    method: 'mcp',
    configPath: detected ? path.join(vscodeDir, 'mcp.json') : null,
    install: () => {
      const mcpPath = path.join(vscodeDir, 'mcp.json');
      fs.mkdirSync(vscodeDir, { recursive: true });
      const existing = readJson(mcpPath);
      const merged = deepMerge(existing, {
        servers: { 'eidos-memory': { type: 'stdio', ...EIDOS_MCP_SERVER } },
      });
      writeJson(mcpPath, merged);
    },
  };
}

function detectAntigravity(): CliDetection {
  const home = os.homedir();
  const configPath = path.join(home, '.gemini', 'antigravity', 'mcp.json');
  const detected = dirExists(path.dirname(configPath));

  return {
    name: 'Antigravity',
    detected,
    method: 'mcp',
    configPath: detected ? configPath : null,
    install: () => {
      const existing = readJson(configPath);
      const merged = deepMerge(existing, { 'eidos-memory': EIDOS_MCP_SERVER });
      writeJson(configPath, merged);
    },
  };
}

function detectGoose(): CliDetection {
  const home = os.homedir();
  const configPath = path.join(home, '.config', 'goose', 'config.yaml');
  const detected = fileExists(configPath);

  return {
    name: 'Goose',
    detected,
    method: 'mcp',
    configPath: detected ? configPath : null,
    install: () => {
      // Goose uses YAML — append MCP config
      const mcpJson = path.join(path.dirname(configPath), 'mcp.json');
      const existing = readJson(mcpJson);
      const merged = deepMerge(existing, { 'eidos-memory': EIDOS_MCP_SERVER });
      writeJson(mcpJson, merged);
    },
  };
}

function detectWarp(): CliDetection {
  const home = os.homedir();
  const configPath = path.join(home, '.warp', 'mcp.json');
  const detected = dirExists(path.dirname(configPath));

  return {
    name: 'Warp',
    detected,
    method: 'mcp',
    configPath: detected ? configPath : null,
    install: () => {
      const existing = readJson(configPath);
      const merged = deepMerge(existing, { 'eidos-memory': EIDOS_MCP_SERVER });
      writeJson(configPath, merged);
    },
  };
}

function detectClaudeCode(): CliDetection {
  const home = os.homedir();
  const claudeDir = path.join(home, '.claude');
  const detected = dirExists(claudeDir) && cmdExists('claude');

  return {
    name: 'Claude Code',
    detected,
    method: 'plugin',
    configPath: detected ? path.join(claudeDir, 'settings.json') : null,
    install: () => {
      // 1. Enable plugins in settings
      const settingsPath = path.join(claudeDir, 'settings.json');
      const settings = readJson(settingsPath);
      settings['plugins'] = { ...(settings['plugins'] as Record<string, unknown> ?? {}), enabled: true };
      // Disable built-in memory so Eidos takes over
      settings['env'] = { ...(settings['env'] as Record<string, unknown> ?? {}), CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
      writeJson(settingsPath, settings);

      // 2. Register marketplace
      const marketsPath = path.join(claudeDir, 'plugins', 'known_marketplaces.json');
      fs.mkdirSync(path.dirname(marketsPath), { recursive: true });
      const markets = readJson(marketsPath);
      const entries = (Array.isArray(markets) ? markets : []) as Array<Record<string, unknown>>;
      if (!entries.some((e) => e['name'] === 'eidos-memory')) {
        entries.push({ name: 'eidos-memory', source: 'local', path: process.cwd() });
      }
      writeJson(marketsPath, entries as unknown as Record<string, unknown>);

      // 3. Register plugin
      const pluginsPath = path.join(claudeDir, 'plugins', 'installed_plugins.json');
      const plugins = readJson(pluginsPath);
      const pluginEntries = (Array.isArray(plugins) ? plugins : []) as Array<Record<string, unknown>>;
      if (!pluginEntries.some((e) => e['name'] === 'eidos-memory')) {
        pluginEntries.push({
          name: 'eidos-memory',
          marketplace: 'eidos-memory',
          enabled: true,
          command: process.platform === 'win32' ? 'eidos.cmd' : 'eidos',
          args: ['mcp'],
        });
      }
      writeJson(pluginsPath, pluginEntries as unknown as Record<string, unknown>);

      // 4. Add MCP config
      const mcpPath = path.join(claudeDir, 'mcp.json');
      const mcpExisting = readJson(mcpPath);
      const mcpMerged = deepMerge(mcpExisting, { mcpServers: { 'eidos-memory': EIDOS_MCP_SERVER } });
      writeJson(mcpPath, mcpMerged);
    },
  };
}

function detectCodex(): CliDetection {
  const home = os.homedir();
  const codexDir = path.join(home, '.codex');
  const detected = dirExists(codexDir) || cmdExists('codex');

  return {
    name: 'Codex CLI',
    detected,
    method: 'mcp',
    configPath: detected ? path.join(codexDir, 'config.json') : null,
    install: () => {
      fs.mkdirSync(codexDir, { recursive: true });
      const configPath = path.join(codexDir, 'config.json');
      const existing = readJson(configPath);
      const merged = deepMerge(existing, {
        mcpServers: { 'eidos-memory': EIDOS_MCP_SERVER },
        plugins: { 'eidos-memory': { enabled: true, command: process.platform === 'win32' ? 'eidos.cmd' : 'eidos', args: ['mcp'] } },
      });
      writeJson(configPath, merged);
    },
  };
}

function detectOpenCode(): CliDetection {
  const home = os.homedir();
  const configDir = path.join(home, '.config', 'opencode');
  const detected = dirExists(configDir);

  return {
    name: 'OpenCode',
    detected,
    method: 'plugin',
    configPath: detected ? path.join(configDir, 'config.json') : null,
    install: () => {
      fs.mkdirSync(configDir, { recursive: true });

      // 1. Write plugin file
      const pluginPath = path.join(configDir, 'plugins', 'eidos-memory.js');
      fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
      const eidosBin = process.platform === 'win32' ? 'eidos.cmd' : 'eidos';
      fs.writeFileSync(pluginPath, `#!/usr/bin/env node
// EidosCore Memory Plugin for OpenCode
const { spawn } = require('child_process');
const proc = spawn('${eidosBin}', ['mcp'], { stdio: 'inherit' });
proc.on('exit', (code) => process.exit(code ?? 0));
`);

      // 2. Add context to AGENTS.md
      const agentsPath = path.join(configDir, 'AGENTS.md');
      const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf-8') : '';
      if (!existing.includes('eidos-memory')) {
        const context = `
## Eidos Memory
You have access to Eidos Memory — a knowledge graph of this project.
- Call assemble_context FIRST before any code question
- Use search_memory for semantic code search
- After every response, call log_conversation
`;
        fs.writeFileSync(agentsPath, existing + context);
      }

      // 3. Write MCP config
      const mcpPath = path.join(configDir, 'mcp.json');
      const mcpExisting = readJson(mcpPath);
      const mcpMerged = deepMerge(mcpExisting, { mcpServers: { 'eidos-memory': EIDOS_MCP_SERVER } });
      writeJson(mcpPath, mcpMerged);
    },
  };
}

function detectOpenClaw(): CliDetection {
  const home = os.homedir();
  const openclawDir = path.join(home, '.openclaw');
  const detected = dirExists(openclawDir);

  return {
    name: 'OpenClaw',
    detected,
    method: 'plugin',
    configPath: detected ? path.join(openclawDir, 'openclaw.json') : null,
    install: () => {
      // 1. Copy extension
      const extDir = path.join(openclawDir, 'extensions', 'eidos-memory');
      fs.mkdirSync(extDir, { recursive: true });
      const eidosBin = process.platform === 'win32' ? 'eidos.cmd' : 'eidos';
      fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({
        name: 'eidos-memory',
        version: '0.2.0',
        description: 'EidosCore memory integration',
        entry: 'index.js',
      }, null, 2));
      fs.writeFileSync(path.join(extDir, 'index.js'), `const { spawn } = require('child_process');
module.exports = { activate: () => { spawn('${eidosBin}', ['mcp'], { stdio: 'inherit' }); } };
`);

      // 2. Register in openclaw.json
      const configPath = path.join(openclawDir, 'openclaw.json');
      const existing = readJson(configPath);
      const extensions = (existing['extensions'] ?? {}) as Record<string, unknown>;
      extensions['eidos-memory'] = { enabled: true, path: extDir };
      existing['extensions'] = extensions;
      writeJson(configPath, existing);
    },
  };
}

function detectRooCode(): CliDetection {
  const home = os.homedir();
  const rooDir = path.join(home, '.roo-code');
  const detected = dirExists(rooDir) || dirExists(path.join(home, '.roo'));

  return {
    name: 'Roo Code',
    detected,
    method: 'mcp',
    configPath: detected ? path.join(rooDir, 'mcp.json') : null,
    install: () => {
      const actualDir = dirExists(rooDir) ? rooDir : path.join(home, '.roo');
      fs.mkdirSync(actualDir, { recursive: true });
      const mcpPath = path.join(actualDir, 'mcp.json');
      const existing = readJson(mcpPath);
      const merged = deepMerge(existing, { mcpServers: { 'eidos-memory': EIDOS_MCP_SERVER } });
      writeJson(mcpPath, merged);
    },
  };
}

function detectCopilot(): CliDetection {
  const home = os.homedir();
  const copilotDir = path.join(home, '.copilot');
  const detected = dirExists(copilotDir) || cmdExists('copilot');

  return {
    name: 'Copilot CLI',
    detected,
    method: 'mcp',
    configPath: detected ? path.join(copilotDir, 'mcp.json') : null,
    install: () => {
      fs.mkdirSync(copilotDir, { recursive: true });
      const mcpPath = path.join(copilotDir, 'mcp.json');
      const existing = readJson(mcpPath);
      const merged = deepMerge(existing, { mcpServers: { 'eidos-memory': EIDOS_MCP_SERVER } });
      writeJson(mcpPath, merged);
    },
  };
}

// ── Main Connect Command ───────────────────────────────────────────────────

export async function connectCommand(_opts: { all?: boolean }): Promise<void> {
  console.log(`\n${c.bold(c.cyan('⚡ Eidos Connect'))} ${c.dim('— Universal CLI Integration')}\n`);

  // Step 1: Detect all CLIs/IDEs
  console.log(c.bold('  Detecting installed CLIs and IDEs...'));
  const detectors = [
    detectClaudeCode(),
    detectClaude(),
    detectQwen(),
    detectGemini(),
    detectCursor(),
    detectWindsurf(),
    detectCodex(),
    detectOpenCode(),
    detectOpenClaw(),
    detectRooCode(),
    detectCopilot(),
    detectContinue(),
    detectVsCode(),
    detectAntigravity(),
    detectGoose(),
    detectWarp(),
  ];

  const detected = detectors.filter((d) => d.detected);
  const notDetected = detectors.filter((d) => !d.detected);

  for (const d of detected) {
    console.log(`  ${c.green('✔')} ${c.bold(d.name)} ${c.dim(`(${d.method} integration)`)}`);
  }
  for (const d of notDetected) {
    console.log(`  ${c.dim('·')} ${c.dim(d.name)} ${c.dim('(not found)')}`);
  }

  if (detected.length === 0) {
    console.log(`\n  ${c.yellow('No supported CLIs/IDEs detected.')}`);
    console.log(`  ${c.dim('Install one of: Qwen, Claude Desktop, Gemini CLI, Cursor, VS Code')}`);
    return;
  }

  // Step 2: Install integrations
  console.log(`\n${c.bold('  Installing integrations...')}`);
  const installed: string[] = [];

  for (const d of detected) {
    try {
      d.install();
      installed.push(d.name);
      console.log(`  ${c.green('✔')} ${d.name} configured`);
    } catch (err) {
      console.log(`  ${c.red('✗')} ${d.name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 3: Start background daemon
  console.log(`\n${c.bold('  Starting EidosCore daemon...')}`);
  try {
    await startDaemon({ mcp: 3742, proxy: 4141, dash: 7842 });
  } catch (err) {
    console.log(`  ${c.yellow('⚠')} Daemon start skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 4: Summary
  console.log(`\n${c.green(c.bold('  ✔ Eidos Connect complete!'))}`);
  console.log(`\n  ${c.bold('Configured:')}`);
  for (const name of installed) {
    console.log(`    ${c.cyan('•')} ${name}`);
  }

  console.log(`\n  ${c.dim('Next steps:')}`);
  console.log(`    ${c.dim('1.')} Restart your CLIs/IDEs`);
  console.log(`    ${c.dim('2.')} Navigate to a project directory`);
  console.log(`    ${c.dim('3.')} Ask any question — Eidos will auto-index and inject context`);
  console.log(`    ${c.dim('4.')} Run ${c.cyan('eidos status')} to check memory health\n`);
}
