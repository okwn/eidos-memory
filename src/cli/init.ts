import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawn } from 'child_process';
import { getDbPath } from '../store/db.js';
import { installGitHook, installWindowsShellHook } from './git_hooks.js';
import { DEFAULT_CONFIG } from './config_validate.js';
import { c } from './spinner.js';
import { registerWorkspace } from './workspaces.js';

const KNOWN_CLIS = ['claude', 'gemini', 'qwen', 'aider', 'sgpt', 'llm'];

const SHELL_HOOK = `
# EidosCore memory injection
_eidos_wrap() {
  local cmd="$1"
  shift
  if command -v eidos &>/dev/null; then
    eidos wrap "$cmd" "$@"
  else
    command "$cmd" "$@"
  fi
}
`;

function detectInstalledClis(): string[] {
  const found: string[] = [];
  for (const cli of KNOWN_CLIS) {
    try {
      execSync(`command -v ${cli}`, { stdio: 'ignore' });
      found.push(cli);
    } catch { /* not installed */ }
  }
  return found;
}

function patchShellProfile(globalMode: boolean): void {
  const home = os.homedir();
  const profiles = [
    path.join(home, '.bashrc'),
    path.join(home, '.zshrc'),
    path.join(home, '.bash_profile'),
  ].filter((p) => fs.existsSync(p));

  if (profiles.length === 0) {
    console.log('[eidos] No shell profiles found. Skipping shell hook installation.');
    return;
  }

  const clis = globalMode ? detectInstalledClis() : [];
  let hookContent = SHELL_HOOK;

  if (clis.length > 0) {
    hookContent += '\n# EidosCore CLI aliases\n';
    for (const cli of clis) {
      hookContent += `alias ${cli}='eidos wrap ${cli}'\n`;
    }
  }

  const marker = '# EidosCore memory injection';
  for (const profile of profiles) {
    const content = fs.readFileSync(profile, 'utf-8');
    if (content.includes(marker)) {
      console.log(`[eidos] Shell hook already present in ${profile}`);
      continue;
    }
    fs.appendFileSync(profile, `\n${hookContent}\n`);
    console.log(`[eidos] Shell hook added to ${profile}`);
  }
}

function initWorkspace(workspace: string): void {
  const dbPath = getDbPath(workspace);
  console.log(`  ${c.dim('DB:')} ${dbPath}`);

  // .eidosignore
  const eidosignore = path.join(workspace, '.eidosignore');
  if (!fs.existsSync(eidosignore)) {
    fs.writeFileSync(eidosignore, [
      '# EidosCore ignore file (same syntax as .gitignore)',
      '.env', '.env.*', '*.pem', '*.key', '*.p12', 'secrets/', 'credentials/',
    ].join('\n'));
    console.log(`  ${c.green('✔')} Created ${c.bold('.eidosignore')}`);
  } else {
    console.log(`  ${c.dim('·')} .eidosignore already exists`);
  }
}

function createDefaultConfig(workspace: string): boolean {
  const configPath = path.join(workspace, 'eidos.config.json');
  if (fs.existsSync(configPath)) {
    console.log(`  ${c.dim('·')} eidos.config.json already exists`);
    return false;
  }
  const cfg = {
    ...DEFAULT_CONFIG,
    workspace,
    adapters: ['claude', 'gemini', 'qwen', 'aider', 'llm', 'sgpt'],
  };
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  console.log(`  ${c.green('✔')} Created ${c.bold('eidos.config.json')}`);
  return true;
}

function spawnBackgroundIndex(workspace: string): void {
  // Resolve the eidos binary: use the current process argv[1] for reliability
  const eidosBin = process.argv[1] ?? 'eidos';
  const child = spawn(process.execPath, [eidosBin, 'index', workspace], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, EIDOS_WORKSPACE: workspace },
  });
  child.unref();
  console.log(`  ${c.green('✔')} Background indexing started ${c.dim('(eidos index ' + workspace + ')')}`);
}

export async function initCommand(opts: { global: boolean }): Promise<void> {
  const workspace = process.cwd();
  console.log(`\n${c.bold(c.cyan('⚡ EidosCore Init'))}  ${c.dim(workspace)}\n`);

  // 1. Workspace DB + .eidosignore + register in workspaces.json
  initWorkspace(workspace);
  registerWorkspace(workspace);
  console.log(`  ${c.green('✔')} Registered in ${c.dim('~/.eidos/workspaces.json')}`);

  // 2. eidos.config.json
  createDefaultConfig(workspace);

  // 3. Git hook
  installGitHook(workspace);
  console.log(`  ${c.green('✔')} Git post-commit hook installed`);

  // 4. Shell / global setup
  if (opts.global) {
    if (process.platform === 'win32') {
      installWindowsShellHook();
      console.log(`  ${c.green('✔')} PowerShell profile patched ${c.dim('(restart PowerShell)')}`);
    } else {
      patchShellProfile(true);
      console.log(`  ${c.green('✔')} Shell profile patched ${c.dim('(run: source ~/.bashrc)')}`);
    }
  }

  // 5. Background index
  spawnBackgroundIndex(workspace);

  // 6. Print MCP snippet
  const eidosBin = process.platform === 'win32' ? 'eidos.cmd' : 'eidos';
  console.log(`\n${c.bold('MCP config snippet')} ${c.dim('— add to your client\'s config:')}`);
  console.log(c.dim('  ┌─────────────────────────────────────────────────────────┐'));
  console.log(`  ${c.cyan(JSON.stringify({ command: eidosBin, args: ['mcp'], env: { EIDOS_WORKSPACE: workspace } }, null, 2).split('\n').join('\n  '))}`);
  console.log(c.dim('  └─────────────────────────────────────────────────────────┘'));

  console.log(`\n${c.green(c.bold('  ✔ EidosCore ready.'))}`);
  if (!opts.global) {
    console.log(`  ${c.dim('Tip:')} Run ${c.cyan('eidos init --global')} to patch your shell aliases.`);
  }
  console.log(`  ${c.dim('Tip:')} Run ${c.cyan('eidos doctor')} to verify your setup.\n`);
}
