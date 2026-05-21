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

# EidosCore prompt indicator: shows [eidos] when .eidos/ exists in current dir
_eidos_prompt() {
  if [ -d ".eidos" ]; then
    echo -e "\\033[36m[eidos]\\033[0m "
  fi
}
# Prepend to existing PROMPT_COMMAND or PS1
if [ -n "$PROMPT_COMMAND" ]; then
  PROMPT_COMMAND='_eidos_prompt;'"$PROMPT_COMMAND"
else
  PROMPT_COMMAND='_eidos_prompt'
fi
`;

function detectInstalledClis(): string[] {
  const found: string[] = [];
  const whichCmd = process.platform === 'win32' ? 'where' : 'command -v';
  for (const cli of KNOWN_CLIS) {
    try {
      execSync(`${whichCmd} ${cli} 2>nul`, { stdio: 'ignore' });
      found.push(cli);
    } catch { /* not installed */ }
  }
  return found;
}

function patchShellProfile(globalMode: boolean): void {
  const home = os.homedir();
  // Both .bashrc (non-login shells: VS Code terminal, tmux) and .bash_profile (login shells)
  // are needed. .zshrc covers zsh users.
  const profiles = [
    path.join(home, '.bashrc'),
    path.join(home, '.zshrc'),
    path.join(home, '.bash_profile'),
  ];

  const existingProfiles = profiles.filter((p) => fs.existsSync(p));
  const clis = globalMode ? detectInstalledClis() : [];
  let hookContent = SHELL_HOOK;

  if (clis.length > 0) {
    hookContent += '\n# EidosCore CLI aliases\n';
    for (const cli of clis) {
      hookContent += `alias ${cli}='eidos wrap ${cli}'\n`;
    }
  }

  // If no bash profiles exist, create both .bashrc and .bash_profile
  // .bashrc is loaded by non-login shells (VS Code terminal, tmux)
  // .bash_profile is loaded by login shells (SSH, macOS Terminal)
  const marker = '# EidosCore memory injection';
  if (existingProfiles.length === 0) {
    const bashrc = path.join(home, '.bashrc');
    const bashProfile = path.join(home, '.bash_profile');
    fs.writeFileSync(bashrc, hookContent.trimStart() + '\n');
    fs.writeFileSync(bashProfile, `source ~/.bashrc\n`);
    console.log(`[eidos] Created shell profiles: ${bashrc}, ${bashProfile}`);
    return;
  }

  for (const profile of existingProfiles) {
    const content = fs.readFileSync(profile, 'utf-8');
    if (content.includes(marker)) {
      console.log(`[eidos] Shell hook already present in ${profile}`);
      continue;
    }
    fs.appendFileSync(profile, `\n${hookContent}\n`);
    console.log(`[eidos] Shell hook added to ${profile}`);
  }

  // Ensure .bashrc exists for non-login shells (VS Code terminal, tmux)
  // Even if .bash_profile was patched, non-login shells won't see it.
  const bashrc = path.join(home, '.bashrc');
  if (!fs.existsSync(bashrc)) {
    fs.writeFileSync(bashrc, hookContent.trimStart() + '\n');
    console.log(`[eidos] Created ${bashrc} for non-login shells`);
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
      const clis = detectInstalledClis();
      // PowerShell auto-wrap
      installWindowsShellHook(clis);
      if (clis.length > 0) {
        console.log(`  ${c.green('✔')} PowerShell profile patched with wrappers for: ${clis.join(', ')} ${c.dim('(restart PowerShell)')}`);
      } else {
        console.log(`  ${c.green('✔')} PowerShell profile patched ${c.dim('(restart PowerShell)')}`);
      }
      // Bash/Git Bash auto-wrap (common on Windows too)
      patchShellProfile(true);
      const bashMsg = fs.existsSync(path.join(os.homedir(), '.bash_profile'))
        ? '(bash start new terminal)'
        : '(bash created .bash_profile, start new terminal)';
      console.log(`  ${c.green('✔')} Bash profile patched ${c.dim(bashMsg)}`);
    } else {
      patchShellProfile(true);
      console.log(`  ${c.green('✔')} Shell profile patched ${c.dim('(run: source ~/.bashrc)')}`);
    }
  }

  // 5. Background index
  spawnBackgroundIndex(workspace);

  // 6. Auto-configure MCP clients
  const { autoDetectAndConfigureMcp } = await import('./mcp_config.js');
  const configuredClients = await autoDetectAndConfigureMcp(workspace);
  if (configuredClients.length > 0) {
    console.log(`  ${c.green('✔')} Auto-configured MCP for: ${c.bold(configuredClients.join(', '))}`);
    console.log(`    ${c.dim('Restart your AI client to pick up the change.')}`);
  } else {
    // Fallback: print snippet for manual config
    const eidosBin = process.platform === 'win32' ? 'eidos.cmd' : 'eidos';
    console.log(`\n${c.bold('MCP config snippet')} ${c.dim('— add to your client\'s config:')}`);
    console.log(c.dim('  ┌─────────────────────────────────────────────────────────┐'));
    console.log(`  ${c.cyan(JSON.stringify({ command: eidosBin, args: ['mcp'] }, null, 2).split('\n').join('\n  '))}`);
    console.log(c.dim('  └─────────────────────────────────────────────────────────┘'));
  }

  console.log(`\n${c.green(c.bold('  ✔ EidosCore ready.'))}`);
  if (!opts.global) {
    console.log(`  ${c.dim('Tip:')} Run ${c.cyan('eidos init --global')} to patch your shell aliases.`);
  }
  console.log(`  ${c.dim('Tip:')} Run ${c.cyan('eidos doctor')} to verify your setup.\n`);
}
