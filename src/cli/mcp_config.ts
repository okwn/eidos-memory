import fs from 'fs';
import path from 'path';
import os from 'os';
import { c } from './spinner.js';

type McpClient = 'claude-desktop' | 'continue' | 'vscode' | 'generic';

interface McpSnippet {
  description: string;
  configPath: string | null;
  json: object;
}

function getWorkspace(): string {
  // Check EIDOS_WORKSPACE env, then eidos.config.json, then cwd
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

async function getSnippet(client: McpClient, workspace: string): Promise<McpSnippet> {
  const command = process.platform === 'win32' ? 'eidos.cmd' : 'eidos';
  const npxArgs = ['-y', 'eidos-memory', 'mcp'];
  const localArgs = [command, 'mcp'];
  const env = { EIDOS_WORKSPACE: workspace };

  // Try to detect if eidos is globally installed
  const useNpx = !(await isGloballyInstalled());
  const args = useNpx ? npxArgs : localArgs.slice(1);
  const cmd  = useNpx ? 'npx' : command;

  const serverBlock = { command: cmd, args, env };

  switch (client) {
    case 'claude-desktop': {
      const configPath = process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : process.platform === 'win32'
          ? path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
          : path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
      return {
        description: 'Claude Desktop (~/.config/Claude/claude_desktop_config.json)',
        configPath,
        json: { mcpServers: { 'eidos-memory': serverBlock } },
      };
    }
    case 'continue': {
      const configPath = path.join(os.homedir(), '.continue', 'config.json');
      return {
        description: 'Continue.dev (~/.continue/config.json)',
        configPath,
        json: {
          experimental: {
            modelContextProtocolServers: [{
              transport: { type: 'stdio', command: cmd, args, env },
            }],
          },
        },
      };
    }
    case 'vscode': {
      const configPath = path.join(process.cwd(), '.vscode', 'mcp.json');
      return {
        description: 'VS Code (.vscode/mcp.json)',
        configPath,
        json: {
          servers: {
            'eidos-memory': { type: 'stdio', command: cmd, args, env },
          },
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
