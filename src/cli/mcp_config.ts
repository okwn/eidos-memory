import fs from 'fs';
import path from 'path';
import os from 'os';
import { c } from './spinner.js';

type McpClient = 'claude-desktop' | 'continue' | 'vscode' | 'qwen' | 'generic';

interface McpSnippet {
  description: string;
  configPath: string | null;
  json: object;
}

function getWorkspace(): string {
  if (process.env['EIDOS_WORKSPACE']) return process.env['EIDOS_WORKSPACE'];
  const cfgPath = path.join(process.cwd(), 'eidos.config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as { workspace?: string };
      if (cfg.workspace) return cfg.workspace;
    } catch { /* ignore */ }
  }
  return process.cwd();
}

// All Eidos MCP tool names for auto-permissions
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
];

async function getSnippet(client: McpClient, _workspace: string): Promise<McpSnippet> {
  const command = process.platform === 'win32' ? 'eidos.cmd' : 'eidos';
  const npxArgs = ['-y', 'eidos-memory', 'mcp'];
  const localArgs = [command, 'mcp'];

  const useNpx = !(await isGloballyInstalled());
  const args = useNpx ? npxArgs : localArgs.slice(1);
  const cmd  = useNpx ? 'npx' : command;

  // No hardcoded EIDOS_WORKSPACE — let EidosCore auto-detect from cwd
  const serverBlock = { command: cmd, args };

  switch (client) {
    case 'claude-desktop': {
      const configPath = process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : process.platform === 'win32'
          ? path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
          : path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
      return {
        description: 'Claude Desktop',
        configPath,
        json: { mcpServers: { 'eidos-memory': serverBlock } },
      };
    }
    case 'continue': {
      const configPath = path.join(os.homedir(), '.continue', 'config.json');
      return {
        description: 'Continue.dev',
        configPath,
        json: {
          experimental: {
            modelContextProtocolServers: [{
              transport: { type: 'stdio', command: cmd, args },
            }],
          },
        },
      };
    }
    case 'vscode': {
      const configPath = path.join(process.cwd(), '.vscode', 'mcp.json');
      return {
        description: 'VS Code',
        configPath,
        json: {
          servers: {
            'eidos-memory': { type: 'stdio', command: cmd, args },
          },
        },
      };
    }
    case 'qwen': {
      const configPath = path.join(os.homedir(), '.qwen', 'settings.json');
      return {
        description: 'Qwen Code',
        configPath,
        json: {
          mcpServers: { 'eidos-memory': serverBlock },
          permissions: { allow: EIDOS_TOOL_PERMISSIONS },
        },
      };
    }
    default: {
      return {
        description: 'Generic MCP client',
        configPath: null,
        json: { mcpServers: { 'eidos-memory': serverBlock } },
      };
    }
  }
}

async function isGloballyInstalled(): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    execSync('eidos --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function printMcpConfig(client: McpClient, copyFlag: boolean): Promise<void> {
  const workspace = getWorkspace();
  const snippet   = await getSnippet(client, workspace);
  const jsonStr   = JSON.stringify(snippet.json, null, 2);

  console.log(`\n${c.bold(c.cyan('⚡ EidosCore MCP Config'))}  ${c.dim('for ' + snippet.description)}\n`);
  console.log(c.cyan(jsonStr));

  if (copyFlag && snippet.configPath) {
    try {
      fs.mkdirSync(path.dirname(snippet.configPath), { recursive: true });

      // Merge into existing config if it exists
      let existing: Record<string, unknown> = {};
      if (fs.existsSync(snippet.configPath)) {
        try { existing = JSON.parse(fs.readFileSync(snippet.configPath, 'utf-8')) as Record<string, unknown>; }
        catch { /* start fresh */ }
      }

      const merged = deepMerge(existing, snippet.json as Record<string, unknown>);
      fs.writeFileSync(snippet.configPath, JSON.stringify(merged, null, 2));
      console.log(`\n${c.green('✔')} Written to ${c.bold(snippet.configPath)}`);
      console.log(`  ${c.dim('Restart your client to pick up the change.')}\n`);
    } catch (e) {
      console.error(`${c.red('✖')} Could not write config: ${e}`);
    }
  } else if (copyFlag) {
    console.log(`\n${c.yellow('⚠')} No known config path for ${client} — copy the snippet above manually.\n`);
  } else {
    console.log(`\n${c.dim('Add the snippet above to your client config, or run with --copy to auto-write.')}\n`);
  }
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

/**
 * Qwen-specific merge: handles mcpServers, permissions.allow, and disables competing memory servers.
 */
function mergeQwenConfig(existing: Record<string, unknown>, snippet: Record<string, unknown>): Record<string, unknown> {
  const result = { ...existing };

  // Merge mcpServers
  const existingServers = (existing['mcpServers'] ?? {}) as Record<string, unknown>;
  const newServers = (snippet['mcpServers'] ?? {}) as Record<string, unknown>;
  result['mcpServers'] = { ...existingServers, ...newServers };

  // Disable competing generic memory server if present
  const servers = result['mcpServers'] as Record<string, unknown>;
  if (servers['memory'] && servers['eidos-memory']) {
    const memServer = servers['memory'] as Record<string, unknown>;
    if (!memServer['_disabled']) {
      memServer['_disabled'] = true;
      servers['memory'] = memServer;
    }
  }

  // Merge permissions.allow — add Eidos tools without removing existing permissions
  const existingPerms = (existing['permissions'] ?? {}) as Record<string, unknown>;
  const existingAllow = (existingPerms['allow'] ?? []) as string[];
  const newAllow = (snippet['permissions'] as Record<string, unknown>)?.['allow'] as string[] ?? [];
  const mergedAllow = [...new Set([...existingAllow, ...newAllow])];
  result['permissions'] = { ...existingPerms, allow: mergedAllow };

  return result;
}

/**
 * Detect all installed MCP clients and auto-configure EidosCore for each one.
 * Called during `eidos init` so users never have to manually edit config files.
 */
export async function autoDetectAndConfigureMcp(workspace: string): Promise<string[]> {
  const configured: string[] = [];

  const candidates: Array<{ client: McpClient; check: () => boolean }> = [
    {
      client: 'qwen',
      check: () => fs.existsSync(path.join(os.homedir(), '.qwen', 'settings.json')),
    },
    {
      client: 'claude-desktop',
      check: () => {
        const p = process.platform === 'darwin'
          ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude')
          : process.platform === 'win32'
            ? path.join(os.homedir(), 'AppData', 'Roaming', 'Claude')
            : path.join(os.homedir(), '.config', 'Claude');
        return fs.existsSync(p);
      },
    },
    {
      client: 'continue',
      check: () => fs.existsSync(path.join(os.homedir(), '.continue', 'config.json')),
    },
    {
      client: 'vscode',
      check: () => fs.existsSync(path.join(process.cwd(), '.vscode')),
    },
  ];

  for (const { client, check } of candidates) {
    if (!check()) continue;

    try {
      const snippet = await getSnippet(client, workspace);
      if (!snippet.configPath) continue;

      fs.mkdirSync(path.dirname(snippet.configPath), { recursive: true });

      let existing: Record<string, unknown> = {};
      if (fs.existsSync(snippet.configPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(snippet.configPath, 'utf-8')) as Record<string, unknown>;
        } catch { /* start fresh */ }
      }

      // Use Qwen-specific merge for Qwen, generic deepMerge for others
      const merged = client === 'qwen'
        ? mergeQwenConfig(existing, snippet.json as Record<string, unknown>)
        : deepMerge(existing, snippet.json as Record<string, unknown>);

      fs.writeFileSync(snippet.configPath, JSON.stringify(merged, null, 2));
      configured.push(snippet.description);
    } catch {
      // Skip clients that fail to configure
    }
  }

  return configured;
}
